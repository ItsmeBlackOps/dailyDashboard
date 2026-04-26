/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import PerformancePill from './PerformancePill';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Reset the patched flag so each test gets a fresh fetch wrapper
  delete (window as any).__perfPatched;
});

function mockNavEntry(domContentLoadedEventEnd: number, startTime = 0) {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { domContentLoadedEventEnd, startTime } as any,
  ]);
}

describe('PerformancePill', () => {
  it('returns null when no perf data is set', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    const { container } = render(<PerformancePill />);
    expect(container.firstChild).toBeNull();
  });

  it('renders FE time from navigation entry', () => {
    mockNavEntry(150, 0); // feMs = 150
    render(<PerformancePill />);
    expect(screen.getByText('150ms FE')).toBeTruthy();
  });

  it('applies text-aurora-emerald when FE latency < 200ms', () => {
    mockNavEntry(100, 0); // 100ms
    const { container } = render(<PerformancePill />);
    const span = container.querySelector('.text-aurora-emerald');
    expect(span).toBeTruthy();
  });

  it('applies text-aurora-amber when FE latency is between 200-499ms', () => {
    mockNavEntry(300, 0); // 300ms
    const { container } = render(<PerformancePill />);
    const span = container.querySelector('.text-aurora-amber');
    expect(span).toBeTruthy();
  });

  it('applies text-aurora-rose when FE latency >= 500ms', () => {
    mockNavEntry(600, 0); // 600ms
    const { container } = render(<PerformancePill />);
    const span = container.querySelector('.text-aurora-rose');
    expect(span).toBeTruthy();
  });

  it('listens for perf-update event and renders BE timing', async () => {
    mockNavEntry(100, 0);
    render(<PerformancePill />);
    // Dispatch a perf-update event with BE timing
    await act(async () => {
      window.dispatchEvent(new CustomEvent('perf-update', { detail: { beMs: 120 } }));
    });
    expect(screen.getByText('120ms BE')).toBeTruthy();
  });

  it('applies text-aurora-emerald to BE timing < 200ms', async () => {
    mockNavEntry(100, 0);
    const { container } = render(<PerformancePill />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('perf-update', { detail: { beMs: 80 } }));
    });
    const spans = container.querySelectorAll('.text-aurora-emerald');
    expect(spans.length).toBeGreaterThanOrEqual(1);
  });

  it('applies text-aurora-rose to BE timing >= 500ms', async () => {
    mockNavEntry(100, 0);
    const { container } = render(<PerformancePill />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('perf-update', { detail: { beMs: 750 } }));
    });
    const span = container.querySelector('.text-aurora-rose');
    expect(span).toBeTruthy();
    expect(screen.getByText('750ms BE')).toBeTruthy();
  });
});
