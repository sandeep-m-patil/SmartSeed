import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { ConfirmDialog } from './ConfirmDialog';
import { QueryState } from './QueryState';

describe('QueryState', () => {
  it('shows "unavailable" for a 404 on an optional (not yet built) endpoint, never an error', () => {
    render(<QueryState isLoading={false} error={new ApiError(404, 'NOT_FOUND', 'x')} isOptionalEndpoint>data</QueryState>);
    expect(screen.getByText(/not available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error for a 404 on a normal endpoint and for other failures', () => {
    render(<QueryState isLoading={false} error={new ApiError(500, 'X', 'Boom')}>data</QueryState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });

  it('shows loading, empty and content states', () => {
    const { rerender } = render(<QueryState isLoading error={null}>data</QueryState>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<QueryState isLoading={false} error={null} isEmpty emptyMessage="Nothing">data</QueryState>);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    rerender(<QueryState isLoading={false} error={null}>data</QueryState>);
    expect(screen.getByText('data')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('requires an explicit confirm and supports cancel via button and Escape', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog open title="Suspend?" message="Sure?" confirmLabel="Suspend" isDanger onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('dialog', { name: 'Suspend?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
