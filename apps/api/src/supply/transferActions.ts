import type { AcceptTransferInput, DispatchTransferInput } from '@smartseed/shared';
import type { Db, Tx } from '../db/db';
import { AppError } from '../errors';
import { writeAudit } from '../audit/audit';
import type { OrgActor } from './actor';
import { recordBlockedAttempt } from './attempts';
import { appendEvent, type EventType } from './events';
import { adjustReserved, applyMovement, ensureHolding, lockHoldings } from './inventory';
import { assertReceiver, assertSender } from './transfers';
import { assertMovable, invalidState, loadBatchGate, lockTransfer, toTransferDto, type TransferRow } from './transferTypes';

const underInvestigation = () => new AppError(409, 'UNDER_INVESTIGATION', 'This transfer is under investigation and cannot proceed');

async function record(tx: Tx, t: TransferRow, actor: OrgActor, type: EventType, extra: { quantity?: number; payload?: Record<string, unknown> } = {}) {
  const counterparty = actor.orgId === t.from_org ? t.to_org : t.from_org;
  await appendEvent(tx, {
    tenantId: t.tenant_id, batchId: t.batch_id, type, actorOrg: actor.orgId, counterpartyOrg: counterparty,
    quantity: extra.quantity ?? t.quantity, transferId: t.id, payload: extra.payload ?? {},
  });
  await writeAudit(tx, {
    tenantId: t.tenant_id, actorId: actor.userId, action: `transfer.${type.replace('transfer_', '')}`, entityType: 'transfer',
    entityId: t.id, ip: actor.ip, metadata: { quantity: extra.quantity ?? t.quantity },
  });
}

async function setStatus(tx: Tx, id: string, status: string, fields: Record<string, unknown> = {}): Promise<TransferRow> {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 3}`).join(', ');
  const res = await tx.query<TransferRow>(
    `UPDATE transfers SET status = $2${sets ? `, ${sets}` : ''}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, ...cols.map((c) => fields[c])],
  );
  return res.rows[0] as TransferRow;
}

async function releaseReservation(tx: Tx, t: TransferRow): Promise<void> {
  const holding = (await lockHoldings(tx, t.batch_id, [t.from_org])).get(t.from_org)!;
  await adjustReserved(tx, holding.id, -t.quantity);
}

async function settle(tx: Tx, t: TransferRow, received: number): Promise<void> {
  await ensureHolding(tx, t.tenant_id, t.batch_id, t.to_org);
  const locked = await lockHoldings(tx, t.batch_id, [t.from_org, t.to_org]);
  const from = locked.get(t.from_org)!;
  const to = locked.get(t.to_org)!;
  await adjustReserved(tx, from.id, -t.quantity);
  await applyMovement(tx, from, -received, 'transfer_out', { refType: 'transfer', refId: t.id });
  await applyMovement(tx, to, received, 'transfer_in', { refType: 'transfer', refId: t.id });
}

export function createTransferActions(db: Db) {
  async function act<T>(actor: OrgActor, id: string, kind: string, fn: (tx: Tx, t: TransferRow) => Promise<T>): Promise<T> {
    try {
      return await db.withSystem(async (tx) => fn(tx, await lockTransfer(tx, id, actor)));
    } catch (err) {
      await recordBlockedAttempt(db, { orgId: actor.orgId, userId: actor.userId, transferId: id, kind }, err);
      throw err;
    }
  }

  const dispatch = (actor: OrgActor, id: string, input: DispatchTransferInput) =>
    act(actor, id, 'transfer_dispatch', async (tx, t) => {
      assertSender(t, actor);
      if (t.status !== 'created') throw invalidState(t.status, 'created');
      if (t.under_investigation) throw underInvestigation();
      assertMovable(await loadBatchGate(tx, t.batch_id));
      const updated = await setStatus(tx, id, 'dispatched', {
        source_location: input.sourceLocation, destination_location: input.destinationLocation,
        carrier: input.carrier ?? null, vehicle_ref: input.vehicleRef ?? null, dispatched_at: new Date(),
      });
      await record(tx, updated, actor, 'transfer_dispatched', { payload: { carrier: input.carrier ?? null } });
      return toTransferDto(updated);
    });

  const markInTransit = (actor: OrgActor, id: string) =>
    act(actor, id, 'transfer_transit', async (tx, t) => {
      assertSender(t, actor);
      if (t.status !== 'dispatched') throw invalidState(t.status, 'dispatched');
      const updated = await setStatus(tx, id, 'in_transit');
      await record(tx, updated, actor, 'transfer_in_transit');
      return toTransferDto(updated);
    });

  const cancel = (actor: OrgActor, id: string) =>
    act(actor, id, 'transfer_cancel', async (tx, t) => {
      assertSender(t, actor);
      if (t.status !== 'created' && t.status !== 'dispatched') throw invalidState(t.status, 'created or dispatched');
      await releaseReservation(tx, t);
      const updated = await setStatus(tx, id, 'cancelled');
      await record(tx, updated, actor, 'transfer_cancelled');
      return toTransferDto(updated);
    });

  const accept = (actor: OrgActor, id: string, input: AcceptTransferInput) =>
    act(actor, id, 'transfer_accept', async (tx, t) => {
      assertReceiver(t, actor);
      if (t.status !== 'dispatched' && t.status !== 'in_transit') throw invalidState(t.status, 'dispatched or in_transit');
      if (t.under_investigation) throw underInvestigation();
      const received = input.receivedQuantity ?? t.quantity;
      if (received < 1 || received > t.quantity) {
        throw new AppError(400, 'INVALID_QUANTITY', `Received quantity must be between 1 and ${t.quantity}`);
      }
      await settle(tx, t, received);
      const updated = await setStatus(tx, id, 'received', { received_quantity: received, received_at: new Date() });
      await record(tx, updated, actor, 'transfer_received', { quantity: received });
      if (received < t.quantity) {
        await record(tx, updated, actor, 'discrepancy_recorded', { quantity: t.quantity - received, payload: { sent: t.quantity, received } });
      }
      return toTransferDto(updated);
    });

  const reject = (actor: OrgActor, id: string, reason: string) =>
    act(actor, id, 'transfer_reject', async (tx, t) => {
      assertReceiver(t, actor);
      if (t.status !== 'dispatched' && t.status !== 'in_transit') throw invalidState(t.status, 'dispatched or in_transit');
      await releaseReservation(tx, t);
      const updated = await setStatus(tx, id, 'rejected');
      await record(tx, updated, actor, 'transfer_rejected', { payload: { reason } });
      return toTransferDto(updated);
    });

  return { dispatch, markInTransit, cancel, accept, reject };
}

export type TransferActions = ReturnType<typeof createTransferActions>;
