import { describe, expect, it } from 'vitest';
import { chainDisplay } from './chain';

const CONFIRMED = /confirmed/i;

describe('chainDisplay', () => {
  it('says confirmed only for committed WITH a transaction id', () => {
    expect(chainDisplay('committed', 'tx-123').label).toMatch(CONFIRMED);
    expect(chainDisplay('committed', 'tx-123').tone).toBe('success');
  });

  it.each([
    ['committed', null], ['committed', ''], ['committed', undefined],
    ['pending', 'tx-1'], ['submitted', 'tx-1'], ['failed', 'tx-1'], [null, null], [undefined, undefined], ['weird', 'tx-1'],
  ])('never says confirmed for status=%s txId=%s', (status, txId) => {
    expect(chainDisplay(status as string | null | undefined, txId as string | null | undefined).label).not.toMatch(CONFIRMED);
  });

  it('flags a committed record with no tx id as a warning', () => {
    expect(chainDisplay('committed', null).tone).toBe('warning');
  });

  it('maps failed to danger and submitted/pending to non-success tones', () => {
    expect(chainDisplay('failed').tone).toBe('danger');
    expect(chainDisplay('submitted').tone).toBe('info');
    expect(chainDisplay('pending').tone).toBe('neutral');
  });
});
