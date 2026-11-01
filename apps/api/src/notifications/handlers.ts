import type { Db } from '../db/db';
import { enqueue } from '../jobs/queue';
import { notifyDevices, notifyUsers, platformAdmins, tenantStaff, usersOfOrg } from './service';

const EXPIRY_WINDOWS_DAYS = [30, 7];
const RECENT_SCAN_DAYS = 7;

interface EventRow {
  id: string; tenant_id: string; batch_id: string; event_type: string; actor_org: string; counterparty_org: string | null;
  quantity: number | null; batch_code: string;
}

/** Stakeholder notifications for a ledger-committed event (spec flow: notify after chain commit). */
export function notifyEventHandler(db: Db) {
  return async (payload: Record<string, unknown>): Promise<void> => {
    await db.withSystem(async (tx) => {
      const res = await tx.query<EventRow>(
        `SELECT e.*, b.batch_code FROM supply_chain_events e JOIN seed_batches b ON b.id = e.batch_id WHERE e.id = $1`, [payload.eventId]);
      const e = res.rows[0];
      if (!e) return;
      const base = { dedupeKey: `event:${e.id}`, payload: { batchId: e.batch_id, eventId: e.id } };
      if (e.event_type === 'batch_registered') {
        await notifyUsers(tx, e.tenant_id, await tenantStaff(tx, e.tenant_id), { ...base, type: 'batch.registered', title: `Batch ${e.batch_code} registered`, body: 'The batch is recorded and confirmed on the blockchain.' });
      } else if (e.event_type === 'transfer_created' && e.counterparty_org) {
        await notifyUsers(tx, e.tenant_id, await usersOfOrg(tx, e.counterparty_org), { ...base, type: 'transfer.incoming', title: `Incoming batch ${e.batch_code}`, body: `${e.quantity} units are being transferred to you. Verify and accept on receipt.` });
      } else if (e.event_type === 'transfer_received' || e.event_type === 'transfer_rejected') {
        const accepted = e.event_type === 'transfer_received';
        await notifyUsers(tx, e.tenant_id, e.counterparty_org ? await usersOfOrg(tx, e.counterparty_org) : [], {
          ...base, type: accepted ? 'transfer.received' : 'transfer.rejected', title: `Batch ${e.batch_code} ${accepted ? 'received' : 'rejected'}`,
          body: accepted ? 'The recipient confirmed receipt.' : 'The recipient rejected the shipment.' });
      }
    });
  };
}

interface AlertRow { id: string; tenant_id: string; batch_id: string; alert_type: string; severity: string; risk_score: number; summary: string; batch_code: string }

/** Alert fan-out: staff always; platform admins and recent scanners for CRITICAL. */
export function notifyAlertHandler(db: Db) {
  return async (payload: Record<string, unknown>): Promise<void> => {
    await db.withSystem(async (tx) => {
      const res = await tx.query<AlertRow>('SELECT a.*, b.batch_code FROM alerts a JOIN seed_batches b ON b.id = a.batch_id WHERE a.id = $1', [payload.alertId]);
      const a = res.rows[0];
      if (!a) return;
      const critical = a.risk_score >= 75;
      const type = critical ? 'alert.critical' : 'alert.high';
      const draft = { type, title: `${critical ? 'Critical' : 'High'} risk: batch ${a.batch_code}`, body: a.summary, dedupeKey: `alert:${a.id}`, payload: { alertId: a.id, batchId: a.batch_id } };
      await notifyUsers(tx, a.tenant_id, [...(await tenantStaff(tx, a.tenant_id)), ...(critical ? await platformAdmins(tx) : [])], draft);
      if (critical) {
        const devices = await tx.query<{ id: string }>(
          `SELECT DISTINCT d.id FROM qr_scans s JOIN public_devices d ON d.device_hash = s.device_hash
           WHERE s.batch_id = $1 AND s.scanned_at > now() - make_interval(days => $2)`, [a.batch_id, RECENT_SCAN_DAYS]);
        await notifyDevices(tx, devices.rows.map((d) => d.id), { type: 'batch.warning', title: 'Seed safety notice', body: 'A batch you recently checked has a serious warning. Avoid relying on it until verified.', dedupeKey: `warn:${a.id}`, payload: { batchId: a.batch_id } });
      }
    });
  };
}

export function notifyAssignmentHandler(db: Db) {
  return async (payload: Record<string, unknown>): Promise<void> => {
    await db.withSystem(async (tx) => {
      const a = await tx.query<{ tenant_id: string; summary: string; batch_code: string }>(
        'SELECT a.tenant_id, a.summary, b.batch_code FROM alerts a JOIN seed_batches b ON b.id = a.batch_id WHERE a.id = $1', [payload.alertId]);
      if (!a.rows[0]) return;
      await notifyUsers(tx, a.rows[0].tenant_id, [String(payload.assigneeId)], {
        type: 'investigation.assigned', title: `Investigation assigned: batch ${a.rows[0].batch_code}`, body: a.rows[0].summary,
        dedupeKey: `assign:${payload.alertId}:${payload.assigneeId}`, payload: { alertId: payload.alertId } });
    });
  };
}

export function notifyInvestigationHandler(db: Db) {
  return async (payload: Record<string, unknown>): Promise<void> => {
    await db.withSystem(async (tx) => {
      const r = await tx.query<{ tenant_id: string; status: string; batch_code: string }>(
        'SELECT i.tenant_id, i.status, b.batch_code FROM investigations i JOIN seed_batches b ON b.id = i.batch_id WHERE i.id = $1', [payload.investigationId]);
      const inv = r.rows[0];
      if (!inv) return;
      const audience = payload.audience === 'authority' ? await platformAdmins(tx) : await tenantStaff(tx, inv.tenant_id);
      await notifyUsers(tx, inv.tenant_id, audience, {
        type: payload.audience === 'resolution' ? 'investigation.resolved' : 'investigation.escalated',
        title: `Investigation ${inv.status.replace(/_/g, ' ')}: batch ${inv.batch_code}`,
        body: `An investigation on batch ${inv.batch_code} changed to "${inv.status.replace(/_/g, ' ')}".`,
        dedupeKey: `inv:${payload.investigationId}:${payload.action}`, payload: { investigationId: payload.investigationId } });
    });
  };
}

/** Daily sweep: warn holders of stock approaching expiry (30 and 7 day windows, once each). */
export function expirySweepHandler(db: Db) {
  return async (): Promise<void> => {
    await db.withSystem(async (tx) => {
      for (const days of EXPIRY_WINDOWS_DAYS) {
        const rows = await tx.query<{ batch_id: string; org_id: string; tenant_id: string; batch_code: string; expiry_date: string }>(
          `SELECT h.batch_id, h.org_id, h.tenant_id, b.batch_code, b.expiry_date FROM batch_holdings h JOIN seed_batches b ON b.id = h.batch_id
           WHERE h.quantity > 0 AND b.expiry_date >= CURRENT_DATE AND b.expiry_date <= CURRENT_DATE + $1::int`, [days]);
        for (const r of rows.rows) {
          await notifyUsers(tx, r.tenant_id, await usersOfOrg(tx, r.org_id), {
            type: 'expiry.warning', title: `Batch ${r.batch_code} expires on ${r.expiry_date}`,
            body: `Stock of batch ${r.batch_code} is within ${days} days of expiry. Expired stock cannot be dispatched or sold.`,
            dedupeKey: `expiry:${r.batch_id}:${r.org_id}:${days}d`, payload: { batchId: r.batch_id } });
        }
      }
      await enqueue(tx, { type: 'expiry_sweep', dedupeKey: 'expiry-sweep-next', delayMs: 24 * 3_600_000 });
    });
  };
}
