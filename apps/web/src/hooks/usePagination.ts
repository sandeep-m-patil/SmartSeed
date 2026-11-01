import { useCallback, useState } from 'react';

export interface Pagination {
  /** Cursor to send with the current page request (undefined for the first page). */
  cursor: string | undefined;
  /** 1-based page number. */
  page: number;
  canPrev: boolean;
  goNext(nextCursor: string | null | undefined): void;
  goPrev(): void;
  reset(): void;
}

/**
 * Cursor pagination state. The API only moves forward, so previous pages are remembered as a
 * stack of cursors; going back pops one. Calling goNext with no cursor is a no-op.
 */
export function usePagination(): Pagination {
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);

  const goNext = useCallback((nextCursor: string | null | undefined) => {
    if (!nextCursor) return;
    setStack((s) => [...s, nextCursor]);
  }, []);
  const goPrev = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback(() => setStack((s) => (s.length === 1 ? s : [undefined])), []);

  return { cursor: stack[stack.length - 1], page: stack.length, canPrev: stack.length > 1, goNext, goPrev, reset };
}
