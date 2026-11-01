import type { Config } from '../config';
import type { Db } from '../db/db';
import { notFound } from '../errors';
import { encryptField, sha256Hex } from '../lib/crypto';
import { enqueue } from '../jobs/queue';
import { hashQrToken } from '../qr/service';
import { raiseAlert } from '../risk/alerts';

const REPORT_ALERT_SCORE = 50;
const NOTIFICATION_LIMIT = 50;

export function createPublicService(db: Db, config: Pick<Config, 'FIELD_ENCRYPTION_KEY'>) {
  const deviceHash = (deviceId: string) => sha256Hex(`${config.FIELD_ENCRYPTION_KEY}:${deviceId}`);

  async function registerDevice(input: { deviceId: string; pushToken?: string | undefined; language: string; region?: string | undefined }) {
    await db.withSystem((tx) =>
      tx.query(
        `INSERT INTO public_devices (device_hash, push_token_enc, language, region) VALUES ($1,$2,$3,$4)
         ON CONFLICT (device_hash) DO UPDATE SET push_token_enc = COALESCE(EXCLUDED.push_token_enc, public_devices.push_token_enc),
           language = EXCLUDED.language, region = COALESCE(EXCLUDED.region, public_devices.region), last_seen_at = now()`,
        [deviceHash(input.deviceId), input.pushToken ? encryptField(input.pushToken, config.FIELD_ENCRYPTION_KEY) : null, input.language, input.region ?? null]));
    return { registered: true };
  }

  /** A farmer report raises (or refreshes) a MEDIUM alert for human review; it never declares a product counterfeit. */
  async function report(input: { token: string; description?: string | undefined; region?: string | undefined; deviceId?: string | undefined }) {
    return db.withSystem(async (tx) => {
      const qr = await tx.query<{ id: string; tenant_id: string; batch_id: string }>(
        'SELECT id, tenant_id, batch_id FROM qr_codes WHERE token_hash = $1', [hashQrToken(input.token)]);
      const row = qr.rows[0];
      if (!row) throw notFound('Code not recognised');
      const saved = await tx.query<{ id: string }>(
        `INSERT INTO counterfeit_reports (tenant_id, batch_id, qr_id, device_hash, region, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [row.tenant_id, row.batch_id, row.id, input.deviceId ? deviceHash(input.deviceId) : null, input.region ?? null, input.description ?? null]);
      await raiseAlert(tx, {
        tenantId: row.tenant_id, batchId: row.batch_id, alertType: 'FARMER_REPORT', severity: 'MEDIUM',
        riskScore: REPORT_ALERT_SCORE, summary: 'A farmer reported a suspected counterfeit packet for this batch.',
      });
      await enqueue(tx, { type: 'score_batch', payload: { batchId: row.batch_id }, dedupeKey: `score:${row.batch_id}` });
      return { reportId: saved.rows[0]?.id as string };
    });
  }

  async function notifications(deviceId: string) {
    return db.withSystem(async (tx) => {
      const res = await tx.query(
        `SELECT n.id, n.type, n.title, n.body, n.created_at AS "createdAt", n.read_at AS "readAt"
         FROM notifications n JOIN public_devices d ON d.id = n.device_id WHERE d.device_hash = $1
         ORDER BY n.created_at DESC LIMIT $2`, [deviceHash(deviceId), NOTIFICATION_LIMIT]);
      return res.rows;
    });
  }

  return { registerDevice, report, notifications };
}

export type PublicService = ReturnType<typeof createPublicService>;
