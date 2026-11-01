import type { ZodType } from 'zod';
import type { VerifyResult } from '../domain/types';
import { ApiError, isRetryable, kindFromStatus } from './errors';
import { envelopeSchema, notificationsSchema, verifyResultSchema, type AppNotification } from './schemas';

export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 400;
const MAX_RETRY_AFTER_SECONDS = 60;

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Anonymous device UUID, sent as X-Device-Id on verify and report calls. */
  getDeviceId?: () => Promise<string | undefined>;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

interface RequestSpec {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  retries: number;
  withDeviceId?: boolean;
}

export interface ReportInput {
  token: string;
  description?: string;
  region?: string;
}

export interface DeviceInput {
  deviceId: string;
  pushToken?: string;
  language: string;
}

export interface ApiClient {
  verify(token: string, location?: GeoPoint): Promise<VerifyResult>;
  report(input: ReportInput): Promise<void>;
  registerDevice(input: DeviceInput): Promise<void>;
  notifications(deviceId: string): Promise<AppNotification[]>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function attempt(spec: RequestSpec): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
      const deviceId = spec.withDeviceId ? await options.getDeviceId?.() : undefined;
      if (deviceId) headers['X-Device-Id'] = deviceId;
      const init: RequestInit = {
        method: spec.method ?? 'GET',
        headers,
        signal: controller.signal,
      };
      if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
      const res = await doFetch(`${baseUrl}${spec.path}`, init);
      return await readEnvelope(res);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(spec: RequestSpec): Promise<unknown> {
    for (let n = 0; ; n++) {
      try {
        return await attempt(spec);
      } catch (err) {
        const apiErr = err as ApiError;
        if (n >= spec.retries || !isRetryable(apiErr)) throw apiErr;
        await sleep(RETRY_BASE_DELAY_MS * 2 ** n);
      }
    }
  }

  const retries = options.retries ?? DEFAULT_RETRIES;
  const enc = encodeURIComponent;

  return {
    verify: async (token, location) =>
      parse(
        verifyResultSchema,
        await request({ path: `/v1/public/verify/${enc(token)}${geoQuery(location)}`, retries, withDeviceId: true }),
      ),
    // POST report is not idempotent: never auto-retry it.
    report: async (input) => void (await request({ path: '/v1/public/reports', method: 'POST', body: input, retries: 0, withDeviceId: true })),
    registerDevice: async (input) =>
      void (await request({ path: '/v1/public/devices', method: 'POST', body: input, retries })),
    notifications: async (deviceId) =>
      parse(notificationsSchema, await request({ path: `/v1/public/notifications?deviceId=${enc(deviceId)}`, retries })),
  };
}

function geoQuery(location?: GeoPoint): string {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return '';
  return `?lat=${location.lat}&lon=${location.lon}`;
}

async function readEnvelope(res: Response): Promise<unknown> {
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('Retry-After'));
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) : undefined;
    throw new ApiError(kindFromStatus(res.status), res.status, seconds);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('INVALID_RESPONSE', res.status);
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success || envelope.data.error) throw new ApiError('INVALID_RESPONSE', res.status);
  return envelope.data.data;
}

function parse<T>(schema: ZodType<T>, data: unknown): T {
  const out = schema.safeParse(data);
  if (!out.success) throw new ApiError('INVALID_RESPONSE');
  return out.data;
}

export function apiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
}
