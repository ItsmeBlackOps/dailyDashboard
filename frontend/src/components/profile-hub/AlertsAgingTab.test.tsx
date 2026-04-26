/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AlertsAgingTab from './AlertsAgingTab';

// Stub child components to avoid testing their internals
vi.mock('./AlertsTab', () => ({
  default: () => <div data-testid="alerts-tab-stub">AlertsTab</div>,
}));

vi.mock('./AgingTab', () => ({
  default: () => <div data-testid="aging-tab-stub">AgingTab</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab(role: string) {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
    if (key === 'role') return role;
    return null;
  });
  return render(
    <MemoryRouter>
      <AlertsAgingTab />
    </MemoryRouter>
  );
}

describe('AlertsAgingTab', () => {
  it('non-mgmt role renders only AlertsTab (no inner tabs)', () => {
    renderTab('recruiter');
    expect(screen.getByTestId('alerts-tab-stub')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByTestId('aging-tab-stub')).toBeNull();
  });

  it('admin role renders inner Tabs with two trigger values', () => {
    renderTab('admin');
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByText('Active Alerts')).toBeTruthy();
    expect(screen.getByText('Aging Buckets')).toBeTruthy();
  });

  it('mam role renders inner tabs', () => {
    renderTab('mam');
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('mm role renders inner tabs', () => {
    renderTab('mm');
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('mlead role renders inner tabs', () => {
    renderTab('mlead');
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('default inner tab is alerts (AlertsTab is visible)', () => {
    renderTab('admin');
    // The default tab "alerts" is active so AlertsTab should be rendered
    expect(screen.getByTestId('alerts-tab-stub')).toBeTruthy();
  });
});
