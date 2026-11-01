import type { Pagination as PaginationState } from '../hooks/usePagination';
import { Button } from './Button';

interface Props {
  pager: PaginationState;
  nextCursor: string | null;
  isFetching?: boolean;
}

export function Pagination({ pager, nextCursor, isFetching = false }: Props) {
  if (!pager.canPrev && !nextCursor) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 pt-3">
      <Button variant="secondary" size="sm" onClick={pager.goPrev} disabled={!pager.canPrev || isFetching}>Previous</Button>
      <span className="text-xs text-slate-600" aria-live="polite">Page {pager.page}{isFetching ? ' (updating)' : ''}</span>
      <Button variant="secondary" size="sm" onClick={() => pager.goNext(nextCursor)} disabled={!nextCursor || isFetching}>Next</Button>
    </nav>
  );
}
