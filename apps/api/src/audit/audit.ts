import { sha256Hex } from '../lib/crypto';
import type { Tx } from '../db/db';

export interface AuditEvent {
  tenantId: string | null;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

const GENESIS_HASH = '0'.repeat(64);
const PLATFORM_CHAIN_KEY = 'platform';

/** JSON with recursively sorted keys, so jsonb round-trips do not change the hash input. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Canonical form hashed into the chain; key order is fixed so it is reproducible. */
export function computeEntryHash(prevHash: string, e: AuditEvent, createdAtIso: string): string {
  return sha256Hex(
    canonicalJson([
      prevHash, e.tenantId, e.actorId ?? null, e.action, e.entityType ?? null,
      e.entityId ?? null, e.ip ?? null, e.metadata ?? {}, createdAtIso,
    ]),
  );
}

interface ChainRow {
  seq: string;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  prev_hash: string;
  entry_hash: string;
  created_at: Date;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtSeq?: string;
}

/** Recomputes the whole chain for one tenant (null = platform chain); used by integrity jobs. */
export async function verifyAuditChain(tx: Tx, tenantId: string | null): Promise<ChainVerification> {
  const res = await tx.query<ChainRow>(
    'SELECT * FROM audit_logs WHERE tenant_id IS NOT DISTINCT FROM $1 ORDER BY seq ASC',
    [tenantId],
  );
  let prev = GENESIS_HASH;
  for (const row of res.rows) {
    const event: AuditEvent = {
      tenantId: row.tenant_id, actorId: row.actor_id, action: row.action,
      ...(row.entity_type ? { entityType: row.entity_type } : {}),
      ...(row.entity_id ? { entityId: row.entity_id } : {}),
      ...(row.ip ? { ip: row.ip } : {}),
      metadata: row.metadata,
    };
    const expected = computeEntryHash(prev, event, row.created_at.toISOString());
    if (row.prev_hash !== prev || row.entry_hash !== expected) {
      return { valid: false, checked: res.rows.length, brokenAtSeq: row.seq };
    }
    prev = row.entry_hash;
  }
  return { valid: true, checked: res.rows.length };
}

/**
 * Appends to the per-tenant hash chain. Must run inside the caller's transaction
 * so the audit row commits atomically with the change it describes. An advisory
 * lock serialises writers per chain so prev_hash is never forked.
 */
export async function writeAudit(tx: Tx, event: AuditEvent): Promise<void> {
  const chainKey = event.tenantId ?? PLATFORM_CHAIN_KEY;
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [chainKey]);
  const prev = await tx.query<{ entry_hash: string }>(
    'SELECT entry_hash FROM audit_logs WHERE tenant_id IS NOT DISTINCT FROM $1 ORDER BY seq DESC LIMIT 1',
    [event.tenantId],
  );
  const prevHash = prev.rows[0]?.entry_hash ?? GENESIS_HASH;
  const createdAt = new Date();
  const entryHash = computeEntryHash(prevHash, event, createdAt.toISOString());
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, action, entity_type, entity_id, ip, metadata, prev_hash, entry_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [event.tenantId, event.actorId ?? null, event.action, event.entityType ?? null, event.entityId ?? null,
      event.ip ?? null, JSON.stringify(event.metadata ?? {}), prevHash, entryHash, createdAt],
  );
}
