import type { Response } from 'express';

export function ok<T>(res: Response, data: T, meta: Record<string, unknown> = {}, status = 200): void {
  res.status(status).json({ data, meta: { requestId: res.req.requestId, ...meta }, error: null });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ data: null, meta: { requestId: res.req.requestId }, error: { code, message, details } });
}
