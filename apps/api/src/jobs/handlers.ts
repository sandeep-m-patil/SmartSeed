import type { Logger } from 'pino';
import type { Db } from '../db/db';
import type { LedgerGateway } from '../blockchain/gateway';
import { verifyBatchLedger } from '../blockchain/verifier';
import { subscriptionSweep } from '../billing/razorpay';
import type { InvestigationService } from '../investigations/service';
import {
  expirySweepHandler, notifyAlertHandler, notifyAssignmentHandler, notifyEventHandler, notifyInvestigationHandler,
} from '../notifications/handlers';
import type { NotificationService } from '../notifications/service';
import type { RiskService } from '../risk/service';
import type { JobHandler } from './queue';
import { enqueue } from './queue';

export interface HandlerDeps {
  db: Db;
  logger: Logger;
  risk?: RiskService | undefined;
  investigations: InvestigationService;
  notifications: NotificationService;
  ledger?: LedgerGateway | undefined;
  billingGraceDays: number;
}

/** The registry of background job types the worker understands. Optional collaborators disable their jobs explicitly. */
export function buildHandlers(d: HandlerDeps): Record<string, JobHandler> {
  const needs = (name: string): never => { throw new Error(`${name} is not configured on this worker`); };
  return {
    score_batch: async (job) => { await (d.risk ?? needs('AI service')).scoreBatch(String(job.payload.batchId)); },
    investigate: async (job) => { await d.investigations.investigate(String(job.payload.alertId)); },
    deliver_notification: async (job) => d.notifications.deliver(String(job.payload.notificationId)),
    notify_event: (job) => notifyEventHandler(d.db)(job.payload),
    notify_alert: (job) => notifyAlertHandler(d.db)(job.payload),
    notify_assignment: (job) => notifyAssignmentHandler(d.db)(job.payload),
    notify_investigation: (job) => notifyInvestigationHandler(d.db)(job.payload),
    expiry_sweep: () => expirySweepHandler(d.db)(),
    subscription_sweep: async () => {
      const result = await subscriptionSweep(d.db, d.billingGraceDays);
      d.logger.info(result, 'subscription sweep');
      await d.db.withSystem((tx) => enqueue(tx, { type: 'subscription_sweep', dedupeKey: 'subscription-sweep-next', delayMs: 24 * 3_600_000 }));
    },
    verify_ledger: async (job) => {
      const gateway = d.ledger ?? needs('Fabric gateway');
      const row = await d.db.withSystem(async (tx) => (await tx.query<{ batch_id: string }>('SELECT batch_id FROM supply_chain_events WHERE id = $1', [job.payload.eventId])).rows[0]);
      if (row) await verifyBatchLedger(d.db, gateway, row.batch_id);
    },
  };
}
