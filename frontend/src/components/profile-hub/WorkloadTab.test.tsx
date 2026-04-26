/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WorkloadTab from './WorkloadTab';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const MOCK_WORKLOAD_RESPONSE = {
  success: true,
  config: { defaultCapacity: 10, capacities: {} },
  recruiters: [
    { email: 'rec1@test.com', name: 'Alice',   activeCount: 9, totalCount: 12, capacity: 10, workloadRatio: 0.9,  workloadStatus: 'overloaded'    },
    { email: 'rec2@test.com', name: 'Bob',      activeCount: 5, totalCount: 8,  capacity: 10, workloadRatio: 0.5,  workloadStatus: 'optimal'       },
    { email: 'rec3@test.com', name: 'Carol',    activeCount: 2, totalCount: 4,  capacity: 10, workloadRatio: 0.2,  workloadStatus: 'underutilized' },
  ],
};

function makeFetch(body: object, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as any);
}

function renderTab() {
  return render(
    <MemoryRouter>
      <WorkloadTab />
    </MemoryRouter>
  );
}

describe('WorkloadTab', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role') return 'recruiter';
      if (key === 'accessToken') return 'tok';
      return null;
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => makeFetch(MOCK_WORKLOAD_RESPONSE));
  });

  it('renders 3 summary cards (Overloaded / Optimal / Underutilized)', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('OVERLOADED')).toBeTruthy();
      expect(screen.getByText('OPTIMAL')).toBeTruthy();
      expect(screen.getByText('UNDERUTILIZED')).toBeTruthy();
    });
  });

  it('summary cards show correct recruiter counts', async () => {
    renderTab();
    await waitFor(() => {
      // 1 overloaded, 1 optimal, 1 underutilized
      const twos = screen.queryAllByText('1');
      // Each status card shows count=1
      expect(twos.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('renders a card for each recruiter with status badge', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Bob')).toBeTruthy();
      expect(screen.getByText('Carol')).toBeTruthy();
    });
  });

  it('renders progress bar with capacity label', async () => {
    renderTab();
    await waitFor(() => {
      // "9 active / 10 capacity" for Alice
      expect(screen.getByText('9 active / 10 capacity')).toBeTruthy();
    });
  });

  it('does not render capacity editor for non-admin', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Alice'));
    expect(screen.queryByText('Capacity Editor')).toBeNull();
  });

  it('admin capacity editor renders for admin role', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role') return 'admin';
      if (key === 'accessToken') return 'tok';
      return null;
    });
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const urlStr = url.toString();
      if (urlStr.includes('hub-config')) {
        return makeFetch({
          success: true,
          agingThresholds: {},
          workloadConfig: { defaultCapacity: 10, capacities: {} },
        });
      }
      return makeFetch(MOCK_WORKLOAD_RESPONSE);
    });

    renderTab();
    await waitFor(() => screen.getByText('Capacity Editor'));
    expect(screen.getByText('Capacity Editor')).toBeTruthy();
  });

  it('saving capacity PUTs correct body', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role') return 'admin';
      if (key === 'accessToken') return 'tok';
      return null;
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const urlStr = url.toString();
      if (urlStr.includes('hub-config')) {
        return makeFetch({
          success: true,
          agingThresholds: {},
          workloadConfig: { defaultCapacity: 10, capacities: {} },
        });
      }
      return makeFetch(MOCK_WORKLOAD_RESPONSE);
    });

    renderTab();
    await waitFor(() => screen.getByText('Capacity Editor'));

    fireEvent.click(screen.getByText('Capacity Editor'));
    await waitFor(() => screen.getByText('Save Capacity Settings'));
    fireEvent.click(screen.getByText('Save Capacity Settings'));

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        c => (c[1] as RequestInit)?.method === 'PUT' && c[0].toString().includes('hub-config')
      );
      expect(putCalls.length).toBeGreaterThan(0);
      const body = JSON.parse((putCalls[0][1] as RequestInit).body as string);
      expect(body.key).toBe('workloadConfig');
      expect(body.value).toHaveProperty('defaultCapacity');
      expect(body.value).toHaveProperty('capacities');
    });
  });
});
