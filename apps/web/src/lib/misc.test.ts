import { describe, expect, it } from 'vitest';
import { buildQuery, isExpiringSoon, shortId } from './format';
import { extractQrToken } from './qrToken';
import { parseSseChunk, queryKeysForEvent } from './sse';

describe('parseSseChunk', () => {
  it('parses complete events and keeps the unfinished remainder', () => {
    const { events, rest } = parseSseChunk('data: {"type":"alert.created","id":"1"}\n\ndata: {"type":"notifica');
    expect(events).toEqual([{ type: 'alert.created', id: '1' }]);
    expect(rest).toBe('data: {"type":"notifica');
  });

  it('skips malformed JSON, comments and untyped payloads', () => {
    const { events } = parseSseChunk(': keepalive\n\ndata: not-json\n\ndata: {"x":1}\n\ndata: {"type":"notification.created"}\n\n');
    expect(events).toEqual([{ type: 'notification.created' }]);
  });

  it('handles CRLF separators', () => {
    expect(parseSseChunk('data: {"type":"a"}\r\n\r\n').events).toHaveLength(1);
  });
});

describe('queryKeysForEvent', () => {
  it('invalidates alert and risk keys for alert.created', () => {
    expect(queryKeysForEvent({ type: 'alert.created' })).toEqual(expect.arrayContaining([['alerts'], ['risk-overview'], ['notifications']]));
  });
  it('invalidates notifications for notification.created and nothing for unknown events', () => {
    expect(queryKeysForEvent({ type: 'notification.created' })).toEqual([['notifications']]);
    expect(queryKeysForEvent({ type: 'other' })).toEqual([]);
  });
});

describe('extractQrToken', () => {
  it('accepts a raw token and a verify URL', () => {
    expect(extractQrToken(' abc_DEF-123 ')).toBe('abc_DEF-123');
    expect(extractQrToken('https://verify.example.com/verify/abc_DEF-123')).toBe('abc_DEF-123');
    expect(extractQrToken('https://verify.example.com/?token=zzz')).toBe('zzz');
  });
  it('rejects empty, oversized or unsafe input', () => {
    expect(extractQrToken('')).toBeNull();
    expect(extractQrToken('has spaces')).toBeNull();
    expect(extractQrToken('../../etc')).toBeNull();
    expect(extractQrToken('a'.repeat(200))).toBeNull();
  });
});

describe('format helpers', () => {
  it('buildQuery omits empty values and encodes the rest', () => {
    expect(buildQuery({ a: '1', b: '', c: undefined, d: null, e: 'x y' })).toBe('?a=1&e=x+y');
    expect(buildQuery({})).toBe('');
  });
  it('isExpiringSoon', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(isExpiringSoon('2026-06-20', now)).toBe(true);
    expect(isExpiringSoon('2026-09-01', now)).toBe(false);
    expect(isExpiringSoon('2026-05-01', now)).toBe(false);
  });
  it('shortId', () => {
    expect(shortId('1234567890abcdef')).toBe('1234567890…');
    expect(shortId(null)).toBe('-');
  });
});
