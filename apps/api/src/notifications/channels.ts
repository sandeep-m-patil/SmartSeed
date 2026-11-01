import nodemailer from 'nodemailer';
import type { Logger } from 'pino';

const PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const PUSH_TIMEOUT_MS = 10_000;

export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export interface PushSender {
  send(msg: { token: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void>;
}

/** SMTP delivery (configure SMTP_URL, e.g. smtps://user:pass@host:465, and EMAIL_FROM). */
export class SmtpEmailSender implements EmailSender {
  private readonly transport;

  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...msg });
  }
}

/** Development-only: logs instead of sending. The worker refuses to use it when NODE_ENV=production. */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.logger.info({ to: msg.to, subject: msg.subject }, 'email (console sender, not delivered)');
  }
}

/** Expo push service; tokens are the ExponentPushToken[...] values devices registered. */
export class ExpoPushSender implements PushSender {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(msg: { token: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
    const res = await this.fetchImpl(PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ to: msg.token, title: msg.title, body: msg.body, data: msg.data ?? {} }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`push service responded ${res.status}`);
  }
}
