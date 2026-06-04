import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom polyfills for Radix Select / Sheet / Tabs.
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

afterEach(cleanup);

const authFetch = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  API_URL: '',
  useAuth: () => ({ authFetch }),
}));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

import { AddUsersDrawer } from '../AddUsersDrawer';
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
];

const okCreated = () => ({
  ok: true,
  json: async () => ({ success: true, created: [], failures: [] }),
});

const lastBody = () => JSON.parse(authFetch.mock.calls.at(-1)![1].body);

beforeEach(() => {
  authFetch.mockReset();
  toast.mockReset();
  authFetch.mockResolvedValue(okCreated());
});

describe('AddUsersDrawer — actor mam, single row creating an mlead', () => {
  const ctx = { selfDisplayName: 'Meena Mam', actorManager: 'Manish Gupta' };

  const renderDrawer = (onCreated = vi.fn()) =>
    render(
      <AddUsersDrawer
        open
        actorRole="mam"
        actorContext={ctx}
        allUsers={roster}
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );

  it('auto-fills team lead from the actor self display name (read-only)', () => {
    renderDrawer();
    // mam → mlead: teamLead is auto = self. Shown as read-only value.
    expect(screen.getByText('Meena Mam')).toBeInTheDocument();
  });

  it('Create POSTs /api/users/bulk with role mlead + auto teamLead = self', async () => {
    const onCreated = vi.fn();
    renderDrawer(onCreated);

    fireEvent.change(screen.getByLabelText('Email 1'), {
      target: { value: 'new.lead@x.com' },
    });
    fireEvent.change(screen.getByLabelText('Password 1'), {
      target: { value: 'Temp1234!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create 1 user/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe('/api/users/bulk');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      email: 'new.lead@x.com',
      password: 'Temp1234!',
      role: 'mlead',
      teamLead: 'Meena Mam',
      manager: 'Manish Gupta',
      active: true,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});

describe('AddUsersDrawer — multi-row + bulk paste', () => {
  const ctx = { selfDisplayName: 'Admin Person', actorManager: '' };

  const renderDrawer = () =>
    render(
      <AddUsersDrawer
        open
        actorRole="admin"
        actorContext={ctx}
        allUsers={roster}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

  it('"+ Add another" appends a second blank row', () => {
    renderDrawer();
    expect(screen.getAllByLabelText(/^Email \d+$/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /add another/i }));
    expect(screen.getAllByLabelText(/^Email \d+$/)).toHaveLength(2);
  });

  it('bulk-pasting two emails parses into two rows', () => {
    renderDrawer();
    // Switch to the Bulk paste tab. Radix Tabs activates on pointerdown
    // (roving focus), which jsdom does not derive from a bare click — so
    // fire pointerDown + click, the documented RTL workaround.
    const bulkTab = screen.getByRole('tab', { name: /bulk paste/i });
    fireEvent.mouseDown(bulkTab);
    fireEvent.click(bulkTab);
    fireEvent.change(screen.getByLabelText(/emails/i), {
      target: { value: 'a@x.com\nb@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^parse$/i }));

    const emailInputs = screen.getAllByLabelText(/^Email \d+$/) as HTMLInputElement[];
    expect(emailInputs).toHaveLength(2);
    const values = emailInputs.map((i) => i.value).sort();
    expect(values).toEqual(['a@x.com', 'b@x.com']);
  });
});

describe('AddUsersDrawer — actor mlead role is forced to recruiter', () => {
  const ctx = { selfDisplayName: 'Brhamdev Sharma', actorManager: 'Manish Gupta' };

  it('POSTs role recruiter for an mlead actor', async () => {
    render(
      <AddUsersDrawer
        open
        actorRole="mlead"
        actorContext={ctx}
        allUsers={roster}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Email 1'), {
      target: { value: 'fresh.recruiter@x.com' },
    });
    fireEvent.change(screen.getByLabelText('Password 1'), {
      target: { value: 'Temp1234!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create 1 user/i }));

    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(lastBody().users[0].role).toBe('recruiter');
  });
});
