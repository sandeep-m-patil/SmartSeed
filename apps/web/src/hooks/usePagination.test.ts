import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePagination } from './usePagination';

describe('usePagination', () => {
  it('starts on page 1 with no cursor and cannot go back', () => {
    const { result } = renderHook(() => usePagination());
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.page).toBe(1);
    expect(result.current.canPrev).toBe(false);
  });

  it('advances with the server cursor and remembers earlier pages', () => {
    const { result } = renderHook(() => usePagination());
    act(() => result.current.goNext('c2'));
    act(() => result.current.goNext('c3'));
    expect(result.current.cursor).toBe('c3');
    expect(result.current.page).toBe(3);
    act(() => result.current.goPrev());
    expect(result.current.cursor).toBe('c2');
    act(() => result.current.goPrev());
    expect(result.current.cursor).toBeUndefined();
    expect(result.current.canPrev).toBe(false);
  });

  it('ignores goNext without a cursor (last page) and goPrev on the first page', () => {
    const { result } = renderHook(() => usePagination());
    act(() => result.current.goNext(null));
    act(() => result.current.goNext(undefined));
    act(() => result.current.goPrev());
    expect(result.current.page).toBe(1);
  });

  it('reset returns to the first page', () => {
    const { result } = renderHook(() => usePagination());
    act(() => result.current.goNext('c2'));
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
    expect(result.current.cursor).toBeUndefined();
  });
});
