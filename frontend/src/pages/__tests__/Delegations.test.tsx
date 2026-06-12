/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Radix Select polyfills for jsdom.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = function () { return false; };
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = function () {};
}

vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch: vi.fn() }),
}));

const api = vi.hoisted(() => ({
  fetchMineDelegations: vi.fn(),
  fetchEligible: vi.fn(),
  fetchPendingApprovals: vi.fn(),
  grantDelegation: vi.fn(async () => ({ success: true })),
  approveDelegation: vi.fn(async () => ({ success: true })),
  rejectDelegation: vi.fn(async () => ({ success: true })),
  revokeDelegation: vi.fn(async () => ({ success: true })),
  transferUser: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/delegationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/delegationApi')>();
  return { ...actual, ...api };
});

const {
  fetchMineDelegations, fetchEligible, fetchPendingApprovals,
  grantDelegation, approveDelegation,
} = api;

import DelegationsPage from '../Delegations';

const UTSA = { email: 'utsa.maiti@vizvainc.com', role: 'user', team: 'technical', teamLead: 'Anusree Vasudevan' };
const SUBHASH = { email: 'subhash.sharma@vizvainc.com', role: 'user', team: 'technical', teamLead: 'Anusree Vasudevan' };

function wire({
  role,
  eligible = {},
  mine = {},
  pending = {},
}: {
  role: string;
  eligible?: Record<string, unknown>;
  mine?: Record<string, unknown>;
  pending?: Record<string, unknown>;
}) {
  localStorage.setItem('role', role);
  localStorage.setItem('email', role === 'user' ? SUBHASH.email : 'anusree.vasudevan@vizvainc.com');
  fetchEligible.mockResolvedValue({
    success: true, actorRole: role, actorTeam: 'technical',
    delegates: [], myPeople: [], deptExperts: [], transferTargets: [],
    ...eligible,
  });
  fetchMineDelegations.mockResolvedValue({
    success: true, owned: [], delegated: [], pendingOwned: [], ...mine,
  });
  fetchPendingApprovals.mockResolvedValue({
    success: true, waitingOnMe: [], myRequests: [], ...pending,
  });
}

async function pickFromSelect(triggerLabel: string, optionName: RegExp | string) {
  const trigger = screen.getByLabelText(triggerLabel);
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: optionName });
  fireEvent.click(option);
}

describe('DelegationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('expert: simplified "Share my work" form sends a day request as pending', async () => {
    wire({ role: 'user', eligible: { delegates: [UTSA] } });
    render(<DelegationsPage />);

    expect(await screen.findByText('Share my work')).toBeInTheDocument();
    // no transfer surface for experts
    expect(screen.queryByText('Transfer to a peer')).toBeNull();

    await pickFromSelect('Teammate', /Utsa Maiti/);
    // summary sentence names the teammate and the approval requirement
    expect(screen.getByText(/Utsa Maiti will see all your tasks/)).toBeInTheDocument();
    expect(screen.getByText(/team lead's approval/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /request coverage/i }));
    await waitFor(() => expect(grantDelegation).toHaveBeenCalled());
    const [, , payload] = grantDelegation.mock.calls[0];
    expect(payload).toMatchObject({
      delegateEmail: UTSA.email,
      scope: 'day',
    });
    expect(payload.dayDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('expert: a dashboard window sends subtree(root=self) with start/end dates', async () => {
    wire({ role: 'user', eligible: { delegates: [UTSA] } });
    render(<DelegationsPage />);
    await screen.findByText('Share my work');

    await pickFromSelect('Teammate', /Utsa Maiti/);
    fireEvent.click(screen.getByRole('button', { name: /my dashboard/i }));
    const to = screen.getByLabelText(/to \(max 30 days\)/i);
    fireEvent.change(to, { target: { value: '2026-06-22' } });

    fireEvent.click(screen.getByRole('button', { name: /request coverage/i }));
    await waitFor(() => expect(grantDelegation).toHaveBeenCalled());
    const [, , payload] = grantDelegation.mock.calls[0];
    expect(payload.scope).toBe('subtree');
    expect(payload.subtreeRootEmail).toBe(SUBHASH.email);
    // endsAt = end of the chosen day in LOCAL time, serialized as UTC ISO.
    expect(new Date(payload.endsAt).getTime()).toBe(new Date('2026-06-22T23:59:59').getTime());
  });

  it('lead: approvals inbox lists expert requests and Approve posts through', async () => {
    wire({
      role: 'lead',
      pending: {
        waitingOnMe: [{
          _id: 'req-1', ownerEmail: SUBHASH.email, delegateEmail: UTSA.email,
          scope: 'day', dayDate: '2026-06-13', subjectEmails: [], subtreeRootEmail: null,
          status: 'pending', grantedAt: '2026-06-12T10:00:00Z', grantedBy: SUBHASH.email,
          expiresAt: null, revokedAt: null, revokedBy: null, reason: 'leave', source: 'manual-ui',
        }],
      },
    });
    render(<DelegationsPage />);

    expect(await screen.findByText(/Awaiting your approval \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Subhash Sharma → Utsa Maiti/)).toBeInTheDocument();
    expect(screen.getByText(/the whole day 2026-06-13/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(approveDelegation).toHaveBeenCalled());
    expect(approveDelegation.mock.calls[0][2]).toBe('req-1');
  });

  it('lead: specific-people share posts the checked subset', async () => {
    wire({
      role: 'lead',
      eligible: {
        delegates: [{ email: 'prateek.narvariya@silverspaceinc.com', role: 'lead', team: 'technical' }],
        myPeople: [SUBHASH, UTSA],
        transferTargets: [{ email: 'prateek.narvariya@silverspaceinc.com', displayName: 'Prateek Narvariya' }],
      },
    });
    render(<DelegationsPage />);
    await screen.findByText('New share');

    await pickFromSelect('Delegate', /Prateek Narvariya/);
    fireEvent.click(screen.getByRole('button', { name: /only specific people/i }));
    fireEvent.click(await screen.findByLabelText('Utsa Maiti'));

    expect(screen.getByText(/1 selected person for 7 days/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /grant share/i }));
    await waitFor(() => expect(grantDelegation).toHaveBeenCalled());
    const [, , payload] = grantDelegation.mock.calls[0];
    expect(payload).toMatchObject({
      scope: 'specific',
      subjectEmails: [UTSA.email],
      ttlDays: 7,
    });
  });

  it('outbound list shows pending requests with a Cancel action', async () => {
    wire({
      role: 'user',
      mine: {
        pendingOwned: [{
          _id: 'p-1', ownerEmail: SUBHASH.email, delegateEmail: UTSA.email,
          scope: 'day', dayDate: '2026-06-14', subjectEmails: [], subtreeRootEmail: null,
          status: 'pending', grantedAt: '2026-06-12T11:00:00Z', grantedBy: SUBHASH.email,
          expiresAt: '2026-06-15T04:00:00Z', revokedAt: null, revokedBy: null, reason: '', source: 'manual-ui',
        }],
      },
    });
    render(<DelegationsPage />);

    expect(await screen.findByText('pending approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
});
