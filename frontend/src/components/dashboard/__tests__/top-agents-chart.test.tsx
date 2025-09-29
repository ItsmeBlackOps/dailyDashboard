/* @vitest-environment jsdom */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { TopAgentsChart } from '../TopAgents';

beforeAll(() => {
  // Stub ResizeObserver used by Recharts ResponsiveContainer
  // @ts-ignore
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Ensure elements report size
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    value: () => ({ width: 800, height: 224, top: 0, left: 0, right: 800, bottom: 224 }),
  });
});

describe('TopAgentsChart', () => {
  it('renders grouped bars with gradients for leaders', () => {
    const leaders = [
      { id: '1', name: 'Alice', counts: { 'Round 1': 5, 'Round 2': 3 }, total: 8 },
      { id: '2', name: 'Bob', counts: { 'Round 1': 4, 'Round 2': 6 }, total: 10 },
    ];
    const rounds = ['Round 1', 'Round 2'];
    const data = rounds.map((r) => ({
      round: r,
      series_0: leaders[0].counts[r] ?? 0,
      series_1: leaders[1].counts[r] ?? 0,
    }));
    const config = {
      series_0: { label: leaders[0].name, color: 'hsl(var(--primary))' },
      series_1: { label: leaders[1].name, color: 'hsl(var(--secondary))' },
    } as const;

    const { container } = render(
      <div style={{ width: 800, height: 240 }}>
        <TopAgentsChart rounds={rounds} data={data} leaders={leaders as any} config={config} />
      </div>
    );

    // Expect gradients for each series
    expect(container.querySelector('linearGradient#glassy-series_0')).toBeTruthy();
    expect(container.querySelector('linearGradient#glassy-series_1')).toBeTruthy();

    // Grid/axes should mount
    const grid = container.querySelector('.recharts-cartesian-grid');
    expect(grid).toBeTruthy();
  });
});
