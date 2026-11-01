import { useCallback, useRef } from 'react';
import { newIdempotencyKey } from '../lib/idempotency';

/**
 * One key per logical submission: a retry after a network error or timeout re-sends the SAME key (so the server
 * can replay instead of double-applying money/stock movements); call `rotate()` after success or when the user edits the form.
 */
export function useIdempotencyKey() {
  const ref = useRef<string>(newIdempotencyKey());
  const rotate = useCallback(() => {
    ref.current = newIdempotencyKey();
  }, []);
  const current = useCallback(() => ref.current, []);
  return { current, rotate };
}
