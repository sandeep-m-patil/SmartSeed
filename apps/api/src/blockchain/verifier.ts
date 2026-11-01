import type { Db } from '../db/db';
import { raiseAlert } from '../risk/alerts';
import { recomputeHash, type EventContext } from './args';
import type { LedgerGateway } from './gateway';

const LEDGER_ALERT_SCORE = 90;

export interface LedgerVerification {
  batchId: string;
  status: 'verified' | 'mismatch' | 'incomplete';
  checked: number;
  mismatches: { eventId: string; reason: 'database_hash' | 'ledger_hash' }[];
}

type EventRow = EventContext['event'] & { tenant_id: string; chain_status: string | null };

/**
 * Re-derives every committed event's hash from the database and compares it with both the stored
 * hash and the hash the ledger committed. Any difference marks the batch 'mismatch' (public
 * verification then turns RED) and raises a CRITICAL alert for human review.
 */
export async function verifyBatchLedger(db: Db, gateway: LedgerGateway, batchId: string): Promise<LedgerVerification> {
  const events = await db.withSystem(async (tx) =>
    (await tx.query<EventRow>(
      `SELECT e.*, t.status AS chain_status FROM supply_chain_events e
       LEFT JOIN blockchain_transactions t ON t.event_id = e.id WHERE e.batch_id = $1 ORDER BY e.sequence`, [batchId])).rows);
  const mismatches: LedgerVerification['mismatches'] = [];
  let checked = 0;
  let incomplete = false;
  for (const e of events) {
    if (e.chain_status === null) continue; // off-chain-only event
    if (e.chain_status !== 'committed') { incomplete = true; continue; }
    checked += 1;
    if (recomputeHash(e) !== e.record_hash) { mismatches.push({ eventId: e.id, reason: 'database_hash' }); continue; }
    const answer = JSON.parse(await gateway.evaluate(e.actor_org, 'VerifyRecordHash', [e.id, e.record_hash])) as { matches: boolean };
    if (!answer.matches) mismatches.push({ eventId: e.id, reason: 'ledger_hash' });
  }
  const status = mismatches.length > 0 ? 'mismatch' : incomplete || checked === 0 ? 'incomplete' : 'verified';
  await db.withSystem(async (tx) => {
    if (status !== 'incomplete') await tx.query('UPDATE seed_batches SET ledger_status = $2 WHERE id = $1', [batchId, status]);
    if (status === 'mismatch' && events[0]) {
      await raiseAlert(tx, {
        tenantId: events[0].tenant_id, batchId, alertType: 'LEDGER_MISMATCH', severity: 'CRITICAL', riskScore: LEDGER_ALERT_SCORE,
        summary: `Ledger verification found ${mismatches.length} record(s) that differ from the blockchain.`,
      });
    }
  });
  return { batchId, status, checked, mismatches };
}
