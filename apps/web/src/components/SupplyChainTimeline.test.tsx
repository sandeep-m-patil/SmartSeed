import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { JourneyEvent } from '../types';
import { ChainStatusBadge } from './ChainStatusBadge';
import { SupplyChainTimeline } from './SupplyChainTimeline';

const event = (over: Partial<JourneyEvent>): JourneyEvent => ({
  sequence: 1, eventType: 'batch_registered', occurredAt: '2026-01-01T10:00:00Z', quantity: 100, actorName: 'Acme Seeds',
  counterpartyName: null, recordHash: 'h', chainStatus: 'pending', chainTxId: null, ...over,
});

describe('ChainStatusBadge', () => {
  it('shows "Confirmed" for committed + tx id', () => {
    render(<ChainStatusBadge status="committed" txId="abc" />);
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it('does not show "Confirmed" for committed without a tx id', () => {
    render(<ChainStatusBadge status="committed" txId={null} />);
    expect(screen.queryByText(/confirmed/i)).toBeNull();
  });
});

describe('SupplyChainTimeline', () => {
  it('renders every event with its own chain badge and no false confirmations', () => {
    render(<SupplyChainTimeline events={[
      event({ sequence: 1, chainStatus: 'committed', chainTxId: 'tx-1' }),
      event({ sequence: 2, eventType: 'transfer_dispatched', chainStatus: 'submitted' }),
      event({ sequence: 3, eventType: 'transfer_received', chainStatus: 'failed' }),
      event({ sequence: 4, eventType: 'retail_sale', chainStatus: null }),
    ]} />);
    expect(screen.getAllByTestId('timeline-event')).toHaveLength(4);
    expect(screen.getAllByText(/confirmed/i)).toHaveLength(1);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Not anchored')).toBeInTheDocument();
  });

  it('shows an empty message with no events', () => {
    render(<SupplyChainTimeline events={[]} />);
    expect(screen.getByText(/no supply-chain events/i)).toBeInTheDocument();
  });
});
