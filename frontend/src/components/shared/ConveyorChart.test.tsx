/* @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ConveyorChart from './ConveyorChart';

afterEach(() => cleanup());

const ITEMS = [
  { label: 'Active',  value: 42,  color: '#22d3ee' },
  { label: 'Pending', value: 18,  color: '#8b5cf6' },
  { label: 'Done',    value: 100, color: '#34d399' },
];

describe('ConveyorChart', () => {
  it('renders title when provided', () => {
    render(<ConveyorChart items={ITEMS} title="Pipeline" />);
    expect(screen.getByText('Pipeline')).toBeTruthy();
  });

  it('does not render a title element when title is omitted', () => {
    render(<ConveyorChart items={ITEMS} />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders one <g> group per item', () => {
    const { container } = render(<ConveyorChart items={ITEMS} />);
    // Moving package groups are direct children of the svg; count animated <g> groups
    // Each item gets a <g> with inline style animation
    const groups = container.querySelectorAll('g[style*="animation"]');
    expect(groups.length).toBe(ITEMS.length);
  });

  it('renders each item value as text', () => {
    render(<ConveyorChart items={ITEMS} />);
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('renders each item label as text (uppercased)', () => {
    render(<ConveyorChart items={ITEMS} />);
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('PENDING')).toBeTruthy();
    expect(screen.getByText('DONE')).toBeTruthy();
  });

  it('renders empty belt without error when items is empty', () => {
    const { container } = render(<ConveyorChart items={[]} />);
    // SVG should still be present
    expect(container.querySelector('svg')).toBeTruthy();
    // No animated package groups
    const groups = container.querySelectorAll('g[style*="animation"]');
    expect(groups.length).toBe(0);
  });

  it('shows the total sum in the header', () => {
    render(<ConveyorChart items={ITEMS} title="Stats" />);
    // total = 42+18+100 = 160
    expect(screen.getByText(/160/)).toBeTruthy();
  });

  it('renders legend items for each package', () => {
    const { container } = render(<ConveyorChart items={ITEMS} />);
    // Legend items render labels as lowercase in the legend span
    const legendText = container.textContent || '';
    expect(legendText).toContain('Active');
    expect(legendText).toContain('Pending');
    expect(legendText).toContain('Done');
  });
});
