export interface Cursor {
  createdAt: string;
  id: string;
}

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    return typeof parsed.createdAt === 'string' && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Fetch limit+1 rows to learn whether another page exists. */
export function toPage<T extends { created_at: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;
  return { items, nextCursor };
}
