export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

export interface ParsedChunk {
  events: ServerEvent[];
  /** Incomplete trailing text to prepend to the next chunk. */
  rest: string;
}

/** Parses `data: {...}` lines of a server-sent-events stream. Malformed payloads are skipped, never thrown. */
export function parseSseChunk(buffer: string): ParsedChunk {
  const events: ServerEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === 'object' && typeof (parsed as ServerEvent).type === 'string') events.push(parsed as ServerEvent);
    } catch {
      // ignore malformed event
    }
  }
  return { events, rest };
}

/** Query keys to invalidate for a server event. */
export function queryKeysForEvent(event: ServerEvent): string[][] {
  if (event.type === 'alert.created') return [['alerts'], ['risk-overview'], ['risk-analytics'], ['notifications']];
  if (event.type === 'notification.created') return [['notifications']];
  return [];
}
