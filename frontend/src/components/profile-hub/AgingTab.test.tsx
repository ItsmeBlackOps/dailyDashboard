/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgingTab from './AgingTab';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const MOCK_AGING_RESPONSE = {
  success: true,
  thresholds: { fresh: 2, warm: 7, aging: 14 },
  summary: { fresh: 10, warm: 5, aging: 3, critical: 1, total: 19 },
  candidates: [
    { _id: 'c1', name: 'Alice', recruiter: 'rec1', branch: 'GGR', status: 'Active', idleDays: 1,  agingStatus: 'fresh',    lastActivity: '2026-04-25' },
    { _id: 'c2', name: 'Bob',   recruiter: 'rec2', branch: 'LKN', status: 'Hold',   idleDays: 10, agingStatus: 'aging',    lastActivity: '2026-04-16' },
    { _id: 'c3', name: 'Carol', recruiter: 'rec1', branch: 'GGR', status: 'Active', idleDays: 20, agingStatus: 'critical', lastActivity: '2026-04-06' },
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
      <AgingTab />
    </MemoryRouter>
  );
}

describe('AgingTab', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role') return 'recruiter';
      if (key === 'accessToken') return 'tok';
      return null;
    });
    vi.spyOn(global, 'fetch').mockImplementation(() => makeFetch(MOCK_AGING_RESPONSE));
  });

  it('renders 4 summary card labels (Fresh / Warm / Aging / Critical)', async () => {
    renderTab();
    await waitFor(() => {
      // Use getAllByText since the text may appear more than once (card label + badge)
      expect(screen.getAllByText('Fresh').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Warm').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Aging').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Critical').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('summary cards show the counts from API response', async () => {
    const { container } = renderTab();
    await waitFor(() => {
      // Each count appears in a "text-2xl font-bold" div
      const bold = container.querySelectorAll('.text-2xl.font-bold');
      const texts = Array.from(bold).map(el => el.textContent);
      expect(texts).toContain('10'); // fresh
      expect(texts).toContain('5');  // warm
      expect(texts).toContain('3');  // aging
      expect(texts).toContain('1');  // critical
    });
  });

  it('renders candidate rows in the table', async () => {
    renderTab();
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Bob')).toBeTruthy();
      expect(screen.getByText('Carol')).toBeTruthy();
    });
  });

  it('filtering by branch fires API call with ?branch=GGR', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const urlStr = url.toString();
      const body = urlStr.includes('branch=GGR')
        ? { ...MOCK_AGING_RESPONSE, candidates: [MOCK_AGING_RESPONSE.candidates[0]] }
        : MOCK_AGING_RESPONSE;
      return makeFetch(body);
    });

    renderTab();
    // Wait for initial render
    await waitFor(() => screen.getByText('Alice'));

    // Find the branch combobox and simulate selecting GGR by directly triggering fetch
    // The select is rendered as a Radix Select with role=combobox
    // We'll verify the API is called with branch=GGR by inspecting fetch calls
    // Simulate by calling fetch with GGR URL directly won't work — instead find the trigger
    const comboboxes = screen.getAllByRole('combobox');
    // First combobox is branch selector
    fireEvent.click(comboboxes[0]);

    // Wait for the listbox to appear (Radix Select portal)
    await waitFor(() => {
      const ggrOption = document.querySelector('[data-value="GGR"]') ||
                        document.getElementById('GGR') ||
                        Array.from(document.querySelectorAll('[role="option"]')).find(el => el.textContent === 'GGR');
      if (ggrOption) {
        fireEvent.click(ggrOption);
      }
    });

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map(c => c[0].toString());
      const hasGGR = calls.some(url => url.includes('branch=GGR'));
      expect(hasGGR).toBe(true);
    }, { timeout: 3000 });
  });

  it('does not render threshold editor for non-admin', async () => {
    renderTab();
    await waitFor(() => {
      const bold = document.querySelectorAll('.text-2xl.font-bold');
      expect(bold.length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Threshold Editor')).toBeNull();
  });

  it('admin-only threshold editor renders when role is admin', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role') return 'admin';
      if (key === 'accessToken') return 'tok';
      return null;
    });
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const urlStr = url.toString();
      if (urlStr.includes('hub-config')) {
        return makeFetch({ success: true, agingThresholds: { fresh: 2, warm: 7, aging: 14 } });
      }
      return makeFetch(MOCK_AGING_RESPONSE);
    });

    renderTab();
    await waitFor(() => screen.getByText('Threshold Editor'));
    expect(screen.getByText('Threshold Editor')).toBeTruthy();
  });

  it('saving thresholds PUTs to /api/candidates/hub-config with correct body', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'role') return 'admin';
      if (key === 'accessToken') return 'tok';
      return null;
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((url) => {
      const urlStr = url.toString();
      if (urlStr.includes('hub-config')) {
        return makeFetch({ success: true, agingThresholds: { fresh: 2, warm: 7, aging: 14 } });
      }
      return makeFetch(MOCK_AGING_RESPONSE);
    });

    renderTab();
    await waitFor(() => screen.getByText('Threshold Editor'));

    // Open the editor
    fireEvent.click(screen.getByText('Threshold Editor'));
    await waitFor(() => screen.getByText('Save Thresholds'));

    // Click save
    fireEvent.click(screen.getByText('Save Thresholds'));

    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(
        c => (c[1] as RequestInit)?.method === 'PUT' && c[0].toString().includes('hub-config')
      );
      expect(putCalls.length).toBeGreaterThan(0);
      const body = JSON.parse((putCalls[0][1] as RequestInit).body as string);
      expect(body.key).toBe('agingThresholds');
      expect(body.value).toEqual({ fresh: 2, warm: 7, aging: 14 });
    });
  });
});
