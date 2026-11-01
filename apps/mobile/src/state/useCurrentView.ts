import { useEffect, useState } from 'react';
import { loadResult, presentResult, type Presentation } from '../storage/cache';
import { useSession } from './session';

/** The result for `token`: the live one from the verify screen, else the local cached copy (stale). */
export function useCurrentView(token: string | undefined): Presentation | null {
  const { current, store } = useSession();
  const [fallback, setFallback] = useState<Presentation | null>(null);
  const live = current && current.token === token ? current.view : null;

  useEffect(() => {
    if (live || !token) return;
    void loadResult(store, token).then((cached) => {
      if (cached) setFallback(presentResult(cached.result, { isCached: true, fetchedAt: cached.fetchedAt }));
    });
  }, [live, token, store]);

  return live ?? fallback;
}
