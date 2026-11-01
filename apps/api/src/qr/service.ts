import { randomBytes } from 'node:crypto';
import type { Config } from '../config';
import type { Db, Tx } from '../db/db';
import { AppError, conflict, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import { decryptField, encryptField, sha256Hex } from '../lib/crypto';
import { decodeCursor, toPage } from '../lib/pagination';
import type { Actor, TenantActor } from '../supply/actor';
import { renderLabel, renderPng, renderSvg, verifyUrl } from './render';

const TOKEN_BYTES = 24; // 192 bits, unguessable
const MAX_PACKAGES_PER_CALL = 5_000;

export const newQrToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');
export const hashQrToken = (token: string): string => sha256Hex(token);

interface QrRow {
  id: string; tenant_id: string; batch_id: string; package_id: string | null; kind: 'batch' | 'package';
  token_enc: string; status: string; issued_at: Date; revoked_at: Date | null; revoke_reason: string | null;
}

interface BatchGate { id: string; status: string; initial_quantity: number; batch_code: string; expiry_date: string; product_name: string; brand: string }

export type QrFormat = 'png' | 'svg' | 'label';

export function createQrService(db: Db, config: Pick<Config, 'FIELD_ENCRYPTION_KEY' | 'PUBLIC_VERIFY_BASE_URL'>) {
  const key = config.FIELD_ENCRYPTION_KEY;
  const toDto = (q: QrRow) => ({
    id: q.id, batchId: q.batch_id, packageId: q.package_id, kind: q.kind, status: q.status, issuedAt: q.issued_at,
    revokedAt: q.revoked_at, revokeReason: q.revoke_reason,
  });

  async function ownedBatch(tx: Tx, actor: TenantActor, batchId: string): Promise<BatchGate> {
    const res = await tx.query<BatchGate>(
      `SELECT b.id, b.status, b.initial_quantity, b.batch_code, b.expiry_date, p.name AS product_name, p.brand
       FROM seed_batches b JOIN products p ON p.id = b.product_id WHERE b.id = $1 AND b.tenant_id = $2`,
      [batchId, actor.tenantId]);
    if (!res.rows[0]) throw notFound('Batch not found');
    return res.rows[0];
  }

  async function issue(tx: Tx, actor: TenantActor, batchId: string, packageId: string | null, supersedes?: string): Promise<QrRow> {
    const token = newQrToken();
    const res = await tx.query<QrRow>(
      `INSERT INTO qr_codes (tenant_id, batch_id, package_id, kind, token_hash, token_enc, issued_by, supersedes_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [actor.tenantId, batchId, packageId, packageId ? 'package' : 'batch', hashQrToken(token), encryptField(token, key), actor.userId, supersedes ?? null]);
    return res.rows[0] as QrRow;
  }

  async function createBatchQr(actor: TenantActor, batchId: string) {
    return db.withSystem(async (tx) => {
      await ownedBatch(tx, actor, batchId);
      const existing = await tx.query("SELECT 1 FROM qr_codes WHERE batch_id = $1 AND kind = 'batch' AND status = 'active'", [batchId]);
      if (existing.rowCount) throw conflict('QR_EXISTS', 'An active batch QR already exists; regenerate it instead');
      const qr = await issue(tx, actor, batchId, null);
      await writeAudit(tx, { tenantId: actor.tenantId, actorId: actor.userId, action: 'qr.issued', entityType: 'qr', entityId: qr.id, ip: actor.ip });
      return toDto(qr);
    });
  }

  async function createPackageQrs(actor: TenantActor, batchId: string, count: number) {
    if (count < 1 || count > MAX_PACKAGES_PER_CALL) throw new AppError(400, 'INVALID_COUNT', `Count must be 1-${MAX_PACKAGES_PER_CALL}`);
    return db.withSystem(async (tx) => {
      const batch = await ownedBatch(tx, actor, batchId);
      const last = await tx.query<{ max: number }>('SELECT COALESCE(MAX(serial_no), 0) AS max FROM packages WHERE batch_id = $1', [batchId]);
      const start = (last.rows[0]?.max as number) + 1;
      if (start - 1 + count > batch.initial_quantity) {
        throw new AppError(409, 'EXCEEDS_BATCH_QUANTITY', 'Package count would exceed the batch quantity');
      }
      const serials = Array.from({ length: count }, (_, i) => start + i);
      const pk = await tx.query<{ id: string }>(
        'INSERT INTO packages (tenant_id, batch_id, serial_no) SELECT $1, $2, s FROM unnest($3::int[]) AS s RETURNING id',
        [actor.tenantId, batchId, serials]);
      const tokens = pk.rows.map(() => newQrToken());
      await tx.query(
        `INSERT INTO qr_codes (tenant_id, batch_id, package_id, kind, token_hash, token_enc, issued_by)
         SELECT $1, $2, p, 'package', h, e, $3 FROM unnest($4::uuid[], $5::text[], $6::text[]) AS t(p, h, e)`,
        [actor.tenantId, batchId, actor.userId, pk.rows.map((r) => r.id), tokens.map(hashQrToken), tokens.map((t) => encryptField(t, key))]);
      await writeAudit(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'qr.packages_issued', entityType: 'batch', entityId: batchId,
        ip: actor.ip, metadata: { count, firstSerial: start },
      });
      return { batchId, count, firstSerial: start, lastSerial: start + count - 1 };
    });
  }

  async function list(actor: Actor, batchId: string, q: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withActor(actor, async (tx) =>
      (await tx.query<QrRow & { created_at: Date }>(
        `SELECT *, issued_at AS created_at FROM qr_codes WHERE batch_id = $1
           AND ($2::timestamptz IS NULL OR (issued_at, id) < ($2, $3::uuid)) ORDER BY issued_at DESC, id DESC LIMIT $4`,
        [batchId, cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    const page = toPage(rows, q.limit);
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  async function download(actor: Actor, qrId: string, format: QrFormat) {
    const { qr, info, serialNo } = await db.withActor(actor, async (tx) => {
      const res = await tx.query<QrRow & BatchGate & { serial_no: number | null }>(
        `SELECT q.*, b.batch_code, b.expiry_date, p.name AS product_name, p.brand, pk.serial_no
         FROM qr_codes q JOIN seed_batches b ON b.id = q.batch_id JOIN products p ON p.id = b.product_id
         LEFT JOIN packages pk ON pk.id = q.package_id WHERE q.id = $1`, [qrId]);
      const row = res.rows[0];
      if (!row) throw notFound('QR code not found');
      return { qr: row, info: { productName: row.product_name, brand: row.brand, batchCode: row.batch_code, expiryDate: row.expiry_date }, serialNo: row.serial_no };
    });
    if (qr.status !== 'active') throw conflict('QR_NOT_ACTIVE', 'Only active QR codes can be downloaded');
    const url = verifyUrl(config.PUBLIC_VERIFY_BASE_URL, decryptField(qr.token_enc, key));
    if (format === 'png') return { contentType: 'image/png', body: await renderPng(url) };
    if (format === 'svg') return { contentType: 'image/svg+xml', body: await renderSvg(url) };
    return { contentType: 'image/svg+xml', body: await renderLabel(url, { ...info, serialNo: serialNo ?? undefined }) };
  }

  async function revoke(actor: TenantActor, qrId: string, reason: string) {
    return db.withSystem(async (tx) => {
      const res = await tx.query<QrRow>(
        `UPDATE qr_codes SET status = 'revoked', revoked_at = now(), revoke_reason = $3
         WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING *`, [qrId, actor.tenantId, reason]);
      if (!res.rows[0]) throw notFound('Active QR code not found');
      await writeAudit(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'qr.revoked', entityType: 'qr', entityId: qrId, ip: actor.ip, metadata: { reason },
      });
      return toDto(res.rows[0]);
    });
  }

  /** Issues a replacement; the old code stays verifiable only as 'superseded' (a warning, never valid). */
  async function regenerate(actor: TenantActor, qrId: string, reason: string) {
    return db.withSystem(async (tx) => {
      const old = await tx.query<QrRow>(
        `UPDATE qr_codes SET status = 'superseded', revoked_at = now(), revoke_reason = $3
         WHERE id = $1 AND tenant_id = $2 AND status = 'active' RETURNING *`, [qrId, actor.tenantId, reason]);
      if (!old.rows[0]) throw notFound('Active QR code not found');
      const fresh = await issue(tx, actor, old.rows[0].batch_id, old.rows[0].package_id, qrId);
      await writeAudit(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'qr.regenerated', entityType: 'qr', entityId: fresh.id,
        ip: actor.ip, metadata: { supersedes: qrId, reason },
      });
      return toDto(fresh);
    });
  }

  async function scans(actor: Actor, qrId: string, q: { limit: number }) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query(
        `SELECT id, scanned_at AS "scannedAt", lat, lon, chain_verified AS "chainVerified", result
         FROM qr_scans WHERE qr_id = $1 ORDER BY scanned_at DESC LIMIT $2`, [qrId, q.limit]);
      return res.rows;
    });
  }

  return { createBatchQr, createPackageQrs, list, download, revoke, regenerate, scans };
}

export type QrService = ReturnType<typeof createQrService>;
