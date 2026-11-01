import type { Logger } from 'pino';
import type { Db, Tx } from '../db/db';
import { notFound } from '../errors';
import { decryptField } from '../lib/crypto';
import { enqueue } from '../jobs/queue';
import { decodeCursor, toPage } from '../lib/pagination';
import type { EmailSender, PushSender } from './channels';

export const CHANNELS = ['in_app', 'email', 'push', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];
const USER_CHANNELS: Channel[] = ['in_app', 'email'];

export interface NotificationDraft {
  type: string;
  title: string;
  body: string;
  /** Stable per logical event; combined with the recipient so each person gets it once per channel. */
  dedupeKey: string;
  payload?: Record<string, unknown>;
}

export interface NotifierDeps {
  db: Db;
  email: EmailSender;
  push: PushSender;
  logger: Logger;
  encryptionKey: string;
}

async function isEnabled(tx: Tx, userId: string, type: string, channel: Channel): Promise<boolean> {
  const res = await tx.query<{ enabled: boolean }>(
    'SELECT enabled FROM notification_preferences WHERE user_id = $1 AND type = $2 AND channel = $3', [userId, type, channel]);
  return res.rows[0]?.enabled ?? true;
}

/** Writes in-app/email rows for users (honouring preferences) and queues delivery. Safe to repeat: dedupe keys. */
export async function notifyUsers(tx: Tx, tenantId: string | null, userIds: string[], draft: NotificationDraft): Promise<number> {
  let created = 0;
  for (const userId of new Set(userIds)) {
    for (const channel of USER_CHANNELS) {
      if (!(await isEnabled(tx, userId, draft.type, channel))) continue;
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO notifications (tenant_id, user_id, type, channel, dedupe_key, title, body, payload, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $4 = 'in_app' THEN now() END)
         ON CONFLICT (dedupe_key, channel) DO NOTHING RETURNING id`,
        [tenantId, userId, draft.type, channel, `${draft.dedupeKey}:${userId}`, draft.title, draft.body, JSON.stringify(draft.payload ?? {})]);
      if (!ins.rows[0]) continue;
      created += 1;
      if (channel === 'email') await enqueue(tx, { type: 'deliver_notification', payload: { notificationId: ins.rows[0].id } });
    }
  }
  return created;
}

/** Push notifications for pseudonymous farmer devices. */
export async function notifyDevices(tx: Tx, deviceIds: string[], draft: NotificationDraft): Promise<number> {
  let created = 0;
  for (const deviceId of new Set(deviceIds)) {
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO notifications (device_id, type, channel, dedupe_key, title, body, payload)
       VALUES ($1,$2,'push',$3,$4,$5,$6) ON CONFLICT (dedupe_key, channel) DO NOTHING RETURNING id`,
      [deviceId, draft.type, `${draft.dedupeKey}:${deviceId}`, draft.title, draft.body, JSON.stringify(draft.payload ?? {})]);
    if (!ins.rows[0]) continue;
    created += 1;
    await enqueue(tx, { type: 'deliver_notification', payload: { notificationId: ins.rows[0].id } });
  }
  return created;
}

export const usersOfOrg = async (tx: Tx, orgId: string): Promise<string[]> =>
  (await tx.query<{ id: string }>("SELECT id FROM users WHERE org_id = $1 AND status = 'active'", [orgId])).rows.map((r) => r.id);

export const tenantStaff = async (tx: Tx, tenantId: string): Promise<string[]> =>
  (await tx.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE u.tenant_id = $1 AND u.status = 'active' AND r.name IN ('company_admin', 'manufacturer')`, [tenantId])).rows.map((r) => r.id);

export const platformAdmins = async (tx: Tx): Promise<string[]> =>
  (await tx.query<{ id: string }>(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'platform_admin' AND u.status = 'active'`)).rows.map((r) => r.id);

export function createNotificationService(deps: NotifierDeps) {
  const { db, email, push, logger, encryptionKey } = deps;

  /** Delivery job: email or push. A failure is thrown so the job queue retries with backoff. */
  async function deliver(notificationId: string): Promise<void> {
    const row = await db.withSystem(async (tx) => {
      const res = await tx.query<{ channel: Channel; title: string; body: string; payload: Record<string, unknown>; email: string | null; push_token_enc: string | null; sent_at: Date | null }>(
        `SELECT n.channel, n.title, n.body, n.payload, n.sent_at, u.email, d.push_token_enc FROM notifications n
         LEFT JOIN users u ON u.id = n.user_id LEFT JOIN public_devices d ON d.id = n.device_id WHERE n.id = $1`, [notificationId]);
      return res.rows[0];
    });
    if (!row || row.sent_at) return;
    if (row.channel === 'email' && row.email) await email.send({ to: row.email, subject: row.title, text: row.body });
    else if (row.channel === 'push' && row.push_token_enc) {
      await push.send({ token: decryptField(row.push_token_enc, encryptionKey), title: row.title, body: row.body, data: row.payload });
    } else logger.info({ notificationId, channel: row.channel }, 'nothing to deliver (no address/token)');
    await db.withSystem((tx) => tx.query('UPDATE notifications SET sent_at = now() WHERE id = $1', [notificationId]));
  }

  async function list(userId: string, tenantId: string | null, q: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withSystem(async (tx) =>
      (await tx.query<{ id: string; created_at: Date }>(
        `SELECT id, type, title, body, payload, read_at AS "readAt", created_at FROM notifications
         WHERE user_id = $1 AND channel = 'in_app' AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $4`, [userId, cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    void tenantId;
    const page = toPage(rows, q.limit);
    return { items: page.items, nextCursor: page.nextCursor };
  }

  async function markRead(userId: string, id: string) {
    const res = await db.withSystem((tx) =>
      tx.query("UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 AND channel = 'in_app'", [id, userId]));
    if (!res.rowCount) throw notFound('Notification not found');
    return { id, read: true };
  }

  async function preferences(userId: string) {
    return db.withSystem(async (tx) =>
      (await tx.query('SELECT type, channel, enabled FROM notification_preferences WHERE user_id = $1 ORDER BY type, channel', [userId])).rows);
  }

  async function setPreferences(userId: string, prefs: { type: string; channel: Channel; enabled: boolean }[]) {
    await db.withSystem(async (tx) => {
      for (const p of prefs) {
        await tx.query(
          `INSERT INTO notification_preferences (user_id, type, channel, enabled) VALUES ($1,$2,$3,$4)
           ON CONFLICT (user_id, type, channel) DO UPDATE SET enabled = EXCLUDED.enabled`, [userId, p.type, p.channel, p.enabled]);
      }
    });
    return preferences(userId);
  }

  return { deliver, list, markRead, preferences, setPreferences };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
