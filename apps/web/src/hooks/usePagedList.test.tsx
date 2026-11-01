import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth';
import { usePagedList } from './usePagedList';

function envelope(items: unknown[], nextCursor: string | null) {
  return new Response(JSON.stringify({ data: items, meta: { nextCursor }, error: null }), { status: 200 });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

afterEach(() => vi.unstubAllGlobals());

describe('usePagedList', () => {
  it('requests the first page, then follows the cursor, and sends filters', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(envelope([{ id: 'a' }], 'cur-2'))
      .mockResolvedValueOnce(envelope([{ id: 'b' }], null));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => usePagedList<{ id: string }>({ queryKey: 't', path: '/v1/things', params: { status: 'open' }, pageSize: 2 }), { wrapper });
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'a' }]));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/things?status=open&limit=2');
    expect(result.current.nextCursor).toBe('cur-2');

    act(() => result.current.pager.goNext(result.current.nextCursor));
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'b' }]));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/v1/things?status=open&limit=2&cursor=cur-2');
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.pager.page).toBe(2);
  });

  it('surfaces API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null, meta: {}, error: { code: 'NOT_FOUND', message: 'nope' } }), { status: 404 })));
    const { result } = renderHook(() => usePagedList({ queryKey: 'e', path: '/v1/x' }), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
