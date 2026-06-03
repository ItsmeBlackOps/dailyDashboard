/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MarketingInfoModal } from '../MarketingInfoModal';

// useAuth reads localStorage and builds an authFetch callback at construction;
// mock it so the bare render does not depend on auth context.
vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch: vi.fn() }),
}));

// Radix Select mounts pointer/observer primitives that jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = function () {
    return false;
  };
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = function () {};
}

describe('MarketingInfoModal', () => {
  it('shows EAD date fields only for EAD-card visa types', () => {
    render(
      <MarketingInfoModal
        open
        candidateId="x"
        initial={{ visaType: 'H1B', company: '', eadStartDate: null, eadEndDate: null }}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />
    );
    expect(screen.queryByLabelText(/EAD start/i)).toBeNull();
  });

  it('shows EAD date fields for an EAD-card visa type', () => {
    render(
      <MarketingInfoModal
        open
        candidateId="y"
        initial={{ visaType: 'OPT', company: '', eadStartDate: null, eadEndDate: null }}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />
    );
    expect(screen.getByLabelText(/EAD start/i)).toBeInTheDocument();
  });
});
