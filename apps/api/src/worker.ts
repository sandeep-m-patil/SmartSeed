import pino from 'pino';
import { loadConfig, type Config } from './config';
import { createDb } from './db/db';
import { processOutbox, type OutboxDeps } from './blockchain/outbox';
import { FabricGateway, DirectoryIdentityProvider } from './blockchain/fabricGateway';
import { EnvKeySigner } from './blockchain/signer';
import { enqueue, runDueJobs } from './jobs/queue';
import { buildHandlers } from './jobs/handlers';
import { createInvestigationService } from './investigations/service';
import { AnthropicProvider } from './investigations/llm';
import { ConsoleEmailSender, ExpoPushSender, SmtpEmailSender, type EmailSender } from './notifications/channels';
import { createNotificationService } from './notifications/service';
import { HttpAiClient } from './risk/aiClient';
import { createRiskService } from './risk/service';

const POLL_INTERVAL_MS = 1_000;

function buildEmailSender(config: Config, logger: pino.Logger): EmailSender {
  if (config.SMTP_URL) return new SmtpEmailSender(config.SMTP_URL, config.EMAIL_FROM);
  if (config.NODE_ENV === 'production') {
    return { send: async () => { throw new Error('SMTP_URL is not configured; email cannot be delivered'); } };
  }
  return new ConsoleEmailSender(logger);
}

function buildLedger(config: Config) {
  const { FABRIC_PEER_ENDPOINT: peer, FABRIC_PEER_TLS_CA_PATH: ca, FABRIC_WALLET_DIR: wallet, APP_SIGNING_PRIVATE_KEY: key } = config;
  if (!peer || !ca || !wallet || !key) return null;
  const gateway = new FabricGateway(
    { peerEndpoint: peer, peerTlsCaPath: ca, peerHostAlias: config.FABRIC_PEER_HOST_ALIAS, channel: config.FABRIC_CHANNEL, chaincode: config.FABRIC_CHAINCODE },
    new DirectoryIdentityProvider(wallet),
  );
  return { gateway, signer: new EnvKeySigner(key) };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  const db = createDb(config.DATABASE_URL);

  const scorer = config.AI_SERVICE_URL && config.AI_SHARED_SECRET ? new HttpAiClient(config.AI_SERVICE_URL, config.AI_SHARED_SECRET) : null;
  const llm = config.ANTHROPIC_API_KEY ? new AnthropicProvider(config.ANTHROPIC_API_KEY, config.INVESTIGATION_MODEL) : undefined;
  const ledger = buildLedger(config);
  if (!scorer) logger.warn('AI_SERVICE_URL/AI_SHARED_SECRET not set: batches will not be scored');
  if (!llm) logger.warn('ANTHROPIC_API_KEY not set: investigations use the evidence-only rule report');
  if (!ledger) logger.error('Fabric is not configured: ledger events stay PENDING and nothing will be shown as blockchain-confirmed');

  const investigations = createInvestigationService({ db, llm, logger });
  const notifications = createNotificationService({
    db, email: buildEmailSender(config, logger), push: new ExpoPushSender(), logger, encryptionKey: config.FIELD_ENCRYPTION_KEY,
  });
  const handlers = buildHandlers({
    db, logger, investigations, notifications, billingGraceDays: config.BILLING_GRACE_DAYS,
    risk: scorer ? createRiskService({ db, scorer, logger }) : undefined, ledger: ledger?.gateway,
  });
  const outbox: OutboxDeps | null = ledger ? { db, gateway: ledger.gateway, signer: ledger.signer, logger, usePrivateData: config.FABRIC_USE_PDC } : null;

  await db.withSystem(async (tx) => {
    await enqueue(tx, { type: 'expiry_sweep', dedupeKey: 'expiry-sweep-next' });
    await enqueue(tx, { type: 'subscription_sweep', dedupeKey: 'subscription-sweep-next' });
  });

  let running = true;
  const stop = () => { running = false; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  logger.info('worker started');
  while (running) {
    try {
      const ranOutbox = outbox ? await processOutbox(outbox) : { committed: 0, retried: 0, failed: 0 };
      const ranJobs = await runDueJobs(db, handlers);
      if (ranJobs + ranOutbox.committed + ranOutbox.retried + ranOutbox.failed === 0) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch (err) {
      logger.error({ err }, 'worker iteration failed');
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  ledger?.gateway.close();
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
