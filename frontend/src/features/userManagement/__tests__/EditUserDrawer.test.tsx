import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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

import { EditUserDrawer } from '../EditUserDrawer';
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

const roster: ManageableUser[] = [
  make({ email: 'manish.gupta@x.com', role: 'mm' }),
  make({ email: 'meena.mam@x.com', role: 'mam' }),
  make({ email: 'brhamdev.sharma@x.com', role: 'mlead' }),
  make({ email: 'arjun.am@x.com', role: 'am' }),
  make({ email: 'prateek.narvariya@x.com', role: 'lead' }),
];

const okResponse = () => ({
  ok: true,
  json: async () => ({ success: true, updates: [], failures: [] }),
});

const lastBody = () => JSON.parse(authFetch.mock.calls.at(-1)![1].body);

beforeEach(() => {
  authFetch.mockReset();
  toast.mockReset();
  authFetch.mockResolvedValue(okResponse());
});

describe('EditUserDrawer — actor mlead editing a recruiter', () => {
  const user = make({ email: 'rahul.recruiter@x.com', role: 'recruiter', active: true });
  const ctx = { selfDisplayName: 'Brhamdev Sharma', actorManager: 'Manish Gupta' };

  const renderDrawer = (onSaved = vi.fn()) =>
    render(
      <EditUserDrawer
        open
        user={user}
        actorRole="mlead"
        actorContext={ctx}
        allUsers={roster}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

  it('renders the role read-only (locked, no role Select)', () => {
    renderDrawer();
    // The recruiter's role label is shown as static text.
    expect(screen.getAllByText('Recruiter').length).toBeGreaterThan(0);
    // No assignable-role combobox exists (mlead canAssign = []).
    expect(screen.queryByLabelText('Role')).toBeNull();
  });

  it('shows the locked team lead as the actor self display name', () => {
    renderDrawer();
    expect(screen.getByText('Brhamdev Sharma')).toBeInTheDocument();
  });

  it('Save PUTs /api/users/bulk with an entry that has NO role key', async () => {
    const onSaved = vi.fn();
    renderDrawer(onSaved);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/users/bulk');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe('rahul.recruiter@x.com');
    expect(body.users[0]).not.toHaveProperty('role');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe('EditUserDrawer — actor admin editing an expert (user)', () => {
  const user = make({ email: 'amartya.kumar@x.com', role: 'user', active: true, team: 'technical' });
  const ctx = { selfDisplayName: 'Admin Person', actorManager: '' };

  const renderDrawer = (onSaved = vi.fn()) =>
    render(
      <EditUserDrawer
        open
        user={user}
        actorRole="admin"
        actorContext={ctx}
        allUsers={roster}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );

  it('renders an editable role Select (admin can assign every role)', () => {
    renderDrawer();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
  });

  it('toggling Active off and saving PUTs { email, active:false } without role (unchanged editable omitted)', async () => {
    renderDrawer();
    // Active starts on; flip it off.
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.users[0]).toEqual({ email: 'amartya.kumar@x.com', active: false });
  });

  it('"Reset password" reveals an input that is sent as entry.password', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    const pwd = screen.getByLabelText(/new password/i);
    fireEvent.change(pwd, { target: { value: 'Sup3rSecret!' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body.users[0].password).toBe('Sup3rSecret!');
    expect(body.users[0].email).toBe('amartya.kumar@x.com');
  });
});

describe('EditUserDrawer — failure handling', () => {
  const user = make({ email: 'amartya.kumar@x.com', role: 'user' });
  const ctx = { selfDisplayName: 'Admin Person', actorManager: '' };

  it('shows a destructive toast and does NOT call onSaved when the request fails', async () => {
    authFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, failures: [{ email: user.email, error: 'nope' }] }),
    });
    const onSaved = vi.fn();
    render(
      <EditUserDrawer
        open
        user={user}
        actorRole="admin"
        actorContext={ctx}
        allUsers={roster}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: 'destructive' });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
