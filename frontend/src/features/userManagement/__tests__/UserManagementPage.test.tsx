import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom polyfills for Radix Select / Sheet (pointer capture, scrollIntoView).
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

// vitest config has no globals → register cleanup manually.
afterEach(cleanup);

// --- mock authFetch + API_URL ---------------------------------------
const authFetch = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  API_URL: '',
  useAuth: () => ({ authFetch }),
}));

// --- mock useToast --------------------------------------------------
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

// --- mock DashboardLayout (heavy: sidebar/header/providers/router) --
vi.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock the data hook so the page is fed deterministic data -------
const refetch = vi.fn().mockResolvedValue(undefined);
const hookState = {
  users: [] as any[],
  loading: false,
  error: '',
  refetch,
  actorContext: { selfDisplayName: 'Admin Person', actorManager: '' },
  actorRole: 'admin',
};
vi.mock('../useManageableUsers', () => ({
  useManageableUsers: () => hookState,
}));

import { UserManagementPage } from '../UserManagementPage';
import type { ManageableUser } from '../grouping';

const make = (over: Partial<ManageableUser> & { email: string }): ManageableUser => ({
  role: 'recruiter',
  active: true,
  acceptsTasks: false,
  teamLead: '',
  manager: '',
  team: null,
  ...over,
});

const okResponse = () => ({
  ok: true,
  json: async () => ({ success: true, updates: [], failures: [] }),
});

beforeEach(() => {
  authFetch.mockReset();
  toast.mockReset();
  refetch.mockClear();
  authFetch.mockResolvedValue(okResponse());
  // default: two users, admin actor, loaded
  hookState.users = [
    make({ email: 'aarav.patel@x.com', role: 'recruiter', teamLead: 'Brhamdev Sharma' }),
    make({ email: 'meena.shah@x.com', role: 'mlead', teamLead: 'Brhamdev Sharma' }),
  ];
  hookState.loading = false;
  hookState.error = '';
  hookState.actorRole = 'admin';
});

describe('UserManagementPage', () => {
  it('renders the table with the manageable users for an admin', () => {
    render(<UserManagementPage />);
    expect(screen.getByText('aarav.patel@x.com')).toBeInTheDocument();
    expect(screen.getByText('meena.shah@x.com')).toBeInTheDocument();
  });

  it('shows the "Add users" button for an actor who can create', () => {
    render(<UserManagementPage />);
    expect(screen.getByRole('button', { name: 'Add users' })).toBeInTheDocument();
  });

  it('PUTs a single active toggle to the bulk endpoint, then refetches', async () => {
    render(<UserManagementPage />);
    // The first data row's Active switch (label "Active").
    const activeSwitches = screen.getAllByRole('switch', { name: 'Active' });
    fireEvent.click(activeSwitches[0]);

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    const [url, opts] = authFetch.mock.calls[0];
    expect(url).toBe('/api/users/bulk');
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ email: 'aarav.patel@x.com', active: false });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('renders the not-authorized state for a non-managing role', () => {
    hookState.actorRole = 'recruiter';
    render(<UserManagementPage />);
    expect(screen.getByText('Not authorized')).toBeInTheDocument();
    expect(screen.queryByText('aarav.patel@x.com')).not.toBeInTheDocument();
  });

  it('renders a Retry button on error and calls refetch when clicked', () => {
    hookState.error = 'boom';
    render(<UserManagementPage />);
    expect(screen.getByText('Could not load users')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders the empty state when there are no users', () => {
    hookState.users = [];
    render(<UserManagementPage />);
    expect(screen.getByText('No users yet')).toBeInTheDocument();
  });
});
