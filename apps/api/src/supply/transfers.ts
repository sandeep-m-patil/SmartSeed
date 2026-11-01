import type { CreateTransferInput, OrgType } from '@smartseed/shared';
import type { Db, Tx } from '../db/db';
import { AppError, forbidden, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import { decodeCursor, toPage } from '../lib/pagination';
import type { Actor, OrgActor } from './actor';
import { recordBlockedAttempt } from './attempts';
import { appendEvent } from './events';
import { adjustReserved, available, findHolding, insufficientInventory, lockHoldings } from './inventory';
import { assertMovable, loadBatchGate, toTransferDto, type TransferRow } from './transferTypes';

const UNIQUE_VIOLATION = '23505';

/** Allowed sender-type -> receiver-type routes in the supply chain. */
export const ALLOWED_ROUTES: Record<OrgType, readonly OrgType[]> = {
  manufacturer: ['distributor'],
  distributor: ['distributor', 'wholesaler', 'retailer'],
  wholesaler: ['retailer'],
  retailer: [],
};

const invalidRecipient = (msg: string) => new AppError(409, 'INVALID_RECIPIENT', msg);

async function assertRoute(tx: Tx, tenantId: string, fromOrg: string, toOrg: string): Promise<void> {
  const res = await tx.query<{ id: string; type: OrgType; status: string }>(
    'SELECT id, type, status FROM organizations WHERE id = ANY($1::uuid[])', [[fromOrg, toOrg]]);
  const from = res.rows.find((o) => o.id === fromOrg);
  const to = res.rows.find((o) => o.id === toOrg);
  if (!from || !to || to.status !== 'active') throw invalidRecipient('Recipient organization not found or inactive');
  if (!ALLOWED_ROUTES[from.type].includes(to.type)) throw invalidRecipient(`A ${from.type} cannot transfer to a ${to.type}`);
  const linked = await tx.query('SELECT 1 FROM tenant_organizations WHERE tenant_id = $1 AND org_id = $2', [tenantId, toOrg]);
  if (!linked.rowCount) throw invalidRecipient('Recipient is not a registered partner for this batch');
}

async function findExisting(tx: Tx, orgId: string, key: string): Promise<TransferRow | null> {
  const res = await tx.query<TransferRow>('SELECT * FROM transfers WHERE from_org = $1 AND idempotency_key = $2', [orgId, key]);
  return res.rows[0] ?? null;
}

function sameRequest(t: TransferRow, input: CreateTransferInput): boolean {
  return t.batch_id === input.batchId && t.to_org === input.toOrgId && t.quantity === input.quantity;
}

async function createTx(tx: Tx, actor: OrgActor, input: CreateTransferInput, key: string) {
  const existing = await findExisting(tx, actor.orgId, key);
  if (existing) {
    if (!sameRequest(existing, input)) throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for a different request');
    return { transfer: existing, replayed: true };
  }
  const holding = await findHolding(tx, input.batchId, actor.orgId);
  if (!holding) throw notFound('Batch not found');
  assertMovable(await loadBatchGate(tx, input.batchId));
  await assertRoute(tx, holding.tenant_id, actor.orgId, input.toOrgId);
  const locked = (await lockHoldings(tx, input.batchId, [actor.orgId])).get(actor.orgId)!;
  if (available(locked) < input.quantity) throw insufficientInventory(available(locked), input.quantity);
  await adjustReserved(tx, locked.id, input.quantity);
  const res = await tx.query<TransferRow>(
    `INSERT INTO transfers (tenant_id, batch_id, from_org, to_org, quantity, idempotency_key, requested_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [holding.tenant_id, input.batchId, actor.orgId, input.toOrgId, input.quantity, key, actor.userId, input.note ?? null],
  );
  const transfer = res.rows[0] as TransferRow;
  await appendEvent(tx, {
    tenantId: holding.tenant_id, batchId: input.batchId, type: 'transfer_created', actorOrg: actor.orgId,
    counterpartyOrg: input.toOrgId, quantity: input.quantity, transferId: transfer.id,
  });
  await writeAudit(tx, {
    tenantId: holding.tenant_id, actorId: actor.userId, action: 'transfer.created', entityType: 'transfer', entityId: transfer.id,
    ip: actor.ip, metadata: { quantity: input.quantity, to: input.toOrgId },
  });
  return { transfer, replayed: false };
}

export function createTransferService(db: Db) {
  async function create(actor: OrgActor, input: CreateTransferInput, key: string) {
    try {
      return await db.withSystem((tx) => createTx(tx, actor, input, key));
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        // A concurrent request with the same key won the race; return its result.
        const existing = await db.withSystem((tx) => findExisting(tx, actor.orgId, key));
        if (existing && sameRequest(existing, input)) return { transfer: existing, replayed: true };
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for a different request');
      }
      await recordBlockedAttempt(db, { orgId: actor.orgId, userId: actor.userId, batchId: input.batchId, kind: 'transfer_create' }, err);
      throw err;
    }
  }

  const SELECT_TRANSFER = `SELECT t.*, fo.legal_name AS from_name, tor.legal_name AS to_name, b.batch_code
    FROM transfers t JOIN seed_batches b ON b.id = t.batch_id
    LEFT JOIN organizations fo ON fo.id = t.from_org LEFT JOIN organizations tor ON tor.id = t.to_org`;

  async function list(actor: Actor, q: { limit: number; cursor?: string | undefined; status?: string | undefined; direction?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withActor(actor, async (tx) =>
      (await tx.query<TransferRow>(
        `${SELECT_TRANSFER}
         WHERE ($1::transfer_status IS NULL OR t.status = $1)
           AND ($2::text IS NULL OR ($2 = 'incoming' AND t.to_org = $3) OR ($2 = 'outgoing' AND t.from_org = $3))
           AND ($4::timestamptz IS NULL OR (t.created_at, t.id) < ($4, $5::uuid))
         ORDER BY t.created_at DESC, t.id DESC LIMIT $6`,
        [q.status ?? null, q.direction ?? null, actor.orgId, cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    const page = toPage(rows, q.limit);
    return { items: page.items.map(toTransferDto), nextCursor: page.nextCursor };
  }

  async function get(actor: Actor, id: string) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query<TransferRow>(`${SELECT_TRANSFER} WHERE t.id = $1`, [id]);
      if (!res.rows[0]) throw notFound('Transfer not found');
      return toTransferDto(res.rows[0]);
    });
  }

  return { create, list, get };
}

export type TransferService = ReturnType<typeof createTransferService>;

export function assertSender(t: TransferRow, actor: OrgActor): void {
  if (t.from_org !== actor.orgId) throw forbidden('NOT_SENDER', 'Only the sending organization can do this');
}

export function assertReceiver(t: TransferRow, actor: OrgActor): void {
  if (t.to_org !== actor.orgId) throw forbidden('NOT_RECEIVER', 'Only the receiving organization can do this');
}
