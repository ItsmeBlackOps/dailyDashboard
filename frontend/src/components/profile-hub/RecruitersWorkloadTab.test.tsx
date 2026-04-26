/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecruitersWorkloadTab from './RecruitersWorkloadTab';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const MOCK_RECRUITERS = {
  success: true,
  recruiters: [
    { email: 'alice@vizvainc.com', name: 'Alice', total: 20, active: 9, po: 2, hold: 1, backout: 0 },
    { email: 'bob@vizvainc.com',   name: 'Bob',   total: 15, active: 5, po: 1, hold: 2, backout: 1 },
  ],
};

const MOCK_WORKLOAD = {
  success: true,
  config: { defaultCapacity: 10, capacities: {} },
  recruiters: [
    { email: 'alice@vizvainc.com', name: 'Alice', activeCount: 9, totalCount: 20, capacity: 10, workloadRatio: 0.9, workloadStatus: 'overloaded' },
    { email: 'bob@vizvainc.com',   name: 'Bob',   activeCount: 5, totalCount: 15, capacity: 10, workloadRatio: 0.5, workloadStatus: 'optimal'    },
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
      <RecruitersWorkloadTab />
    </MemoryRouter>
  );
}

describe('RecruitersWorkloadTab', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role')        return 'recruiter';
      if (key === 'accessToken') return 'tok';
      if (key === 'email')       return 'alice@vizvainc.com';
      if (key === 'name')        return 'Alice';
      return null;
    });
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const urlStr = url.toString();
      if (urlStr.includes('hub-workload'))   return makeFetch(MOCK_WORKLOAD);
      if (urlStr.includes('hub-recruiters')) return makeFetch(MOCK_RECRUITERS);
      return makeFetch({ success: true, profiles: [], total: 0 });
    });
  });

  it('merges data from both endpoints and renders recruiter cards', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Bob')).toBeTruthy();
    });
  });

  it('each recruiter card shows a workload status badge', async () => {
    renderTab();
    await waitFor(() => {
      // Alice is overloaded, Bob is optimal
      expect(screen.getByText('OVERLOADED')).toBeTruthy();
      expect(screen.getByText('OPTIMAL')).toBeTruthy();
    });
  });

  it('current user card (Alice, email in list) has violet ring class', async () => {
    const { container } = renderTab();
    await waitFor(() => screen.getByText('Alice'));
    const violetCards = container.querySelectorAll('.ring-violet-500\\/60');
    expect(violetCards.length).toBeGreaterThanOrEqual(1);
  });

  it('current user card shows "You" badge', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('You')).toBeTruthy();
    });
  });

  it('when current user is NOT in recruiter list, a "You" card is prepended', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role')        return 'recruiter';
      if (key === 'accessToken') return 'tok';
      if (key === 'email')       return 'charlie@vizvainc.com'; // not in list
      if (key === 'name')        return 'Charlie';
      return null;
    });

    renderTab();
    await waitFor(() => {
      // A "You" badge should be injected for charlie
      expect(screen.getByText('You')).toBeTruthy();
    });
  });

  it('when current user IS in the list, no duplicate card added', async () => {
    renderTab();
    await waitFor(() => screen.getByText('Alice'));
    // Alice should appear exactly once as a card title
    const aliceEls = screen.getAllByText('Alice');
    // There may be a "You" badge but not two separate card name headings
    // The key indicator: only one "You" badge
    const youEls = screen.queryAllByText('You');
    expect(youEls.length).toBe(1);
  });

  it('sort toggle buttons are rendered (performance / workload / name)', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('performance')).toBeTruthy();
      expect(screen.getByText('workload')).toBeTruthy();
      expect(screen.getByText('name')).toBeTruthy();
    });
  });

  it('clicking "name" sort button changes active sort', async () => {
    renderTab();
    await waitFor(() => screen.getByText('name'));
    const nameBtn = screen.getByText('name');
    fireEvent.click(nameBtn);
    // After click, name button should have the active (bg-primary) class
    await waitFor(() => {
      expect(nameBtn.className).toContain('bg-primary');
    });
  });
});
