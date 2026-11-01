import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '../auth';
import { SSE_RETRY_BASE_MS, SSE_RETRY_MAX_MS } from '../lib/constants';
import { parseSseChunk, queryKeysForEvent } from '../lib/sse';

/**
 * Subscribes to GET /v1/events with fetch + ReadableStream (EventSource cannot send an Authorization header)
 * and invalidates the relevant react-query keys on each event. Reconnects with backoff; a 404 means the
 * endpoint is not deployed yet, so it stops quietly.
 */
export function useEventStream(isEnabled: boolean): void {
  const qc = useQueryClient();
  const { getAccessToken, refreshSession } = useAuth();

  useEffect(() => {
    if (!isEnabled) return undefined;
    const controller = new AbortController();
    let retryMs = SSE_RETRY_BASE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function connect(): Promise<void> {
      try {
        let res = await fetch('/v1/events', { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, Accept: 'text/event-stream' }, signal: controller.signal });
        if (res.status === 401 && (await refreshSession())) {
          res = await fetch('/v1/events', { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, Accept: 'text/event-stream' }, signal: controller.signal });
        }
        if (res.status === 404 || res.status === 501) return;
        if (!res.ok || !res.body) throw new Error(`Event stream failed (${res.status})`);
        retryMs = SSE_RETRY_BASE_MS;
        await readStream(res.body.getReader());
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void connect(), retryMs);
        retryMs = Math.min(retryMs * 2, SSE_RETRY_MAX_MS);
      }
    }

    async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseChunk(buffer);
        buffer = rest;
        for (const event of events) for (const queryKey of queryKeysForEvent(event)) void qc.invalidateQueries({ queryKey });
      }
    }

    void connect();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isEnabled, qc, getAccessToken, refreshSession]);
}
