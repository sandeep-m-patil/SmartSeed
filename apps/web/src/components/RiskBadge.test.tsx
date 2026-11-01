import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RiskBadge } from './RiskBadge';

describe('RiskBadge', () => {
  it.each([[10, 'Low'], [30, 'Medium'], [60, 'High'], [90, 'Critical']])('shows the word for score %s', (score, word) => {
    render(<RiskBadge score={score} />);
    expect(screen.getByText(new RegExp(word))).toBeInTheDocument();
  });

  it('includes the numeric score so level is not conveyed by colour alone', () => {
    render(<RiskBadge score={82} />);
    expect(screen.getByText('(82)')).toBeInTheDocument();
  });

  it('prefers an explicit level from the API', () => {
    const { container } = render(<RiskBadge score={null} level="high" />);
    expect(container.querySelector('[data-risk-level="HIGH"]')).not.toBeNull();
  });

  it('says "Not assessed" when there is no score or level', () => {
    render(<RiskBadge score={null} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
  });
});
