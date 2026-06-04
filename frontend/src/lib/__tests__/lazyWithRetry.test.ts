import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { lazyWithRetry } from '../lazyWithRetry';

// Minimal error boundary so a rethrown rejection doesn't blow up the test renderer.
class Boundary extends React.Component<
  { children: React.ReactNode; onError: (e: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? React.createElement('div', null, 'boundary') : this.props.children;
  }
}

/** Render a lazy component to completion inside Suspense + an error boundary. */
async function renderLazy(Comp: React.LazyExoticComponent<React.ComponentType<unknown>>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const errors: unknown[] = [];
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        Boundary,
        { onError: (e) => errors.push(e) },
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'loading') },
          React.createElement(Comp),
        ),
      ),
    );
  });
  // Let any pending lazy promise + a possible second attempt flush.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, errors, root };
}

const reloadMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  // jsdom's window.location.reload is non-configurable to overwrite directly; redefine it.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadMock },
  });
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('lazyWithRetry', () => {
  it('reloads the page once when the import factory throws a chunk-load error', async () => {
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('error loading dynamically imported module'));
    const Comp = lazyWithRetry(factory as () => Promise<{ default: React.ComponentType<unknown> }>);

    await renderLazy(Comp);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('resolves to the component and does NOT reload on a successful import', async () => {
    const Hello: React.FC = () => React.createElement('span', null, 'hello-chunk');
    const factory = vi.fn().mockResolvedValue({ default: Hello });
    const Comp = lazyWithRetry(factory as () => Promise<{ default: React.ComponentType<unknown> }>);

    const { container } = await renderLazy(Comp);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('hello-chunk');
  });

  it('rethrows (no reload) on a second consecutive chunk failure when the reload flag is already set', async () => {
    // Simulate that a reload was already attempted in this tab.
    window.sessionStorage.setItem('__chunk_reloaded', '1');
    const factory = vi
      .fn()
      .mockRejectedValue(new Error('Loading chunk 7 failed'));
    const Comp = lazyWithRetry(factory as () => Promise<{ default: React.ComponentType<unknown> }>);

    const { errors } = await renderLazy(Comp);

    expect(reloadMock).not.toHaveBeenCalled();
    // The error boundary caught the rethrown chunk error.
    expect(errors.length).toBeGreaterThan(0);
    expect(String((errors[0] as Error)?.message)).toMatch(/Loading chunk/i);
  });
});
