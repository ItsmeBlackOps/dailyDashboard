/* @vitest-environment jsdom */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { OverallInterviewsChart } from '../KpiOverview';

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

describe('OverallInterviewsChart', () => {
  it('renders bar chart with glassy gradient', () => {
    const data = [
      { round: 'Round 1', interviews: 10 },
      { round: 'Round 2', interviews: 7 },
    ];
    const config = {
      interviews: { label: 'Interviews', color: 'hsl(var(--primary))' },
    } as const;

    const { container } = render(
      <div style={{ width: 800, height: 240 }}>
        <OverallInterviewsChart data={data} config={config} />
      </div>
    );

    // Gradient defs for glassy look
    const gradient = container.querySelector('linearGradient#glassy-interviews');
    expect(gradient).toBeTruthy();

    // Grid/axes should mount
    const grid = container.querySelector('.recharts-cartesian-grid');
    expect(grid).toBeTruthy();
  });
});
