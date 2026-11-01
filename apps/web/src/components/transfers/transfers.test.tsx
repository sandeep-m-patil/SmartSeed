import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { varianceOf } from './AcceptDialog';
import { availableActions } from './TransferRowActions';

const full = { canCreate: true, canReceive: true };

describe('availableActions', () => {
  it('offers dispatch/cancel on created outgoing transfers', () => {
    expect(availableActions({ status: 'created' }, 'outgoing', full)).toEqual(['dispatch', 'cancel']);
  });
  it('offers transit/cancel once dispatched, nothing in transit', () => {
    expect(availableActions({ status: 'dispatched' }, 'outgoing', full)).toEqual(['transit', 'cancel']);
    expect(availableActions({ status: 'in_transit' }, 'outgoing', full)).toEqual([]);
  });
  it('offers accept/reject to the receiver while goods are on the way', () => {
    expect(availableActions({ status: 'dispatched' }, 'incoming', full)).toEqual(['accept', 'reject']);
    expect(availableActions({ status: 'in_transit' }, 'incoming', full)).toEqual(['accept', 'reject']);
    expect(availableActions({ status: 'created' }, 'incoming', full)).toEqual([]);
  });
  it('offers nothing without the matching permission or for terminal states', () => {
    expect(availableActions({ status: 'created' }, 'outgoing', { canCreate: false, canReceive: true })).toEqual([]);
    expect(availableActions({ status: 'dispatched' }, 'incoming', { canCreate: true, canReceive: false })).toEqual([]);
    expect(availableActions({ status: 'received' }, 'incoming', full)).toEqual([]);
  });
});

describe('varianceOf', () => {
  it('is negative when short, positive when over, zero when omitted', () => {
    expect(varianceOf(100, 90)).toBe(-10);
    expect(varianceOf(100, 105)).toBe(5);
    expect(varianceOf(100, undefined)).toBe(0);
  });
});

describe('useIdempotencyKey', () => {
  it('keeps the same key across retries and changes it after rotate()', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const first = result.current.current();
    expect(result.current.current()).toBe(first);
    act(() => result.current.rotate());
    expect(result.current.current()).not.toBe(first);
  });
});
