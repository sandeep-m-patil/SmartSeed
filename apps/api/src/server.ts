import pino from 'pino';
import { Redis } from 'ioredis';
import { loadConfig } from './config';
import { createDb } from './db/db';
import { createTokenService } from './auth/tokens';
import { createApp } from './app';
import { RazorpayGateway } from './billing/razorpay';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  const db = createDb(config.DATABASE_URL);
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL) : undefined;
  const tokens = await createTokenService(config);
  const paymentGateway = config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET ? new RazorpayGateway(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET) : undefined;
  const app = createApp({ config, db, tokens, logger, ...(redis ? { redis } : {}), ...(paymentGateway ? { paymentGateway } : {}) });

  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'));
  const shutdown = () => {
    server.close(async () => {
      await db.close();
      redis?.disconnect();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
