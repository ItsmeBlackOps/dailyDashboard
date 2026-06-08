import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// This repo's vitest config does not enable `globals`, so React Testing
// Library's automatic per-test cleanup is not registered. Unmount manually.
afterEach(cleanup);

import { TooltipProvider } from '@/components/ui/tooltip';
import { RoleBadge } from '../RoleBadge';
import { UserRow } from '../UserRow';
import { UserTable } from '../UserTable';
import { groupUsers, type ManageableUser } from '../grouping';

const make = (over: Partial<ManageableUser> & { email: string }): ManageableUser => ({
  role: 'recruiter',
  active: true,
  acceptsTasks: false,
  teamLead: '',
  manager: '',
  team: null,
  ...over,
});

const noop = () => {};

// Helper: render a single component inside a real <table> so <tr>/<td>
// land in valid DOM (avoids React hydration warnings + keeps roles intact).
// TooltipProvider mirrors the page-level provider (PageShell) that now
// hosts the per-row toggle tooltips after they were hoisted out of each cell.
const renderInTable = (node: React.ReactNode) =>
  render(
    <TooltipProvider>
      <table>
        <tbody>{node}</tbody>
      </table>
    </TooltipProvider>,
  );

describe('RoleBadge', () => {
  it('renders the human label for a legacy role token', () => {
    render(<RoleBadge role="mm" />);
    expect(screen.getByText('Marketing Manager')).toBeInTheDocument();
  });
});

describe('UserRow', () => {
  const user = make({
    email: 'aarav.patel@x.com',
    role: 'recruiter',
    team: 'marketing',
    manager: 'Tushar Ahuja',
    active: true,
    acceptsTasks: true,
  });

  it('renders name (derived), email, role badge, team and manager', () => {
    renderInTable(
      <UserRow
        user={user}
        selected={false}
        canToggleActive
        canToggleAccepts
        onSelect={noop}
        onOpen={noop}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    expect(screen.getByText('Aarav Patel')).toBeInTheDocument();
    expect(screen.getByText('aarav.patel@x.com')).toBeInTheDocument();
    expect(screen.getByText('Recruiter')).toBeInTheDocument();
    expect(screen.getByText('marketing')).toBeInTheDocument();
    expect(screen.getByText('Tushar Ahuja')).toBeInTheDocument();
  });

  it('clicking the row calls onOpen with the user', () => {
    const onOpen = vi.fn();
    renderInTable(
      <UserRow
        user={user}
        selected={false}
        canToggleActive
        canToggleAccepts
        onSelect={noop}
        onOpen={onOpen}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    fireEvent.click(screen.getByText('Aarav Patel'));
    expect(onOpen).toHaveBeenCalledWith(user);
  });

  it('clicking the checkbox calls onSelect but NOT onOpen', () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    renderInTable(
      <UserRow
        user={user}
        selected={false}
        canToggleActive
        canToggleAccepts
        onSelect={onSelect}
        onOpen={onOpen}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onSelect).toHaveBeenCalledWith(user, true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('toggling Active calls onToggleActive(user, false) and not onOpen', () => {
    const onToggleActive = vi.fn();
    const onOpen = vi.fn();
    renderInTable(
      <UserRow
        user={user}
        selected={false}
        canToggleActive
        canToggleAccepts
        onSelect={noop}
        onOpen={onOpen}
        onToggleActive={onToggleActive}
        onToggleAccepts={noop}
      />,
    );
    // Active is on → flipping it yields false.
    const activeSwitch = screen.getByLabelText('Active');
    fireEvent.click(activeSwitch);
    expect(onToggleActive).toHaveBeenCalledWith(user, false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a disabled Active switch when canToggleActive is false', () => {
    renderInTable(
      <UserRow
        user={user}
        selected={false}
        canToggleActive={false}
        canToggleAccepts
        onSelect={noop}
        onOpen={noop}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    expect(screen.getByLabelText('Active')).toBeDisabled();
  });

  it('shows an em-dash instead of an Accepts switch when acceptsTasks is undefined', () => {
    const u = make({ email: 'no.accept@x.com', acceptsTasks: undefined });
    renderInTable(
      <UserRow
        user={u}
        selected={false}
        canToggleActive
        canToggleAccepts
        onSelect={noop}
        onOpen={noop}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    expect(screen.queryByLabelText('Accepts tasks')).toBeNull();
  });
});

describe('UserTable', () => {
  const users: ManageableUser[] = [
    make({ email: 'aarav.patel@x.com', role: 'recruiter', teamLead: 'Brhamdev Sharma' }),
    make({ email: 'priya.singh@x.com', role: 'mlead', teamLead: 'Brhamdev Sharma' }),
  ];

  it('renders a group header with its label and count, then the rows', () => {
    const groups = groupUsers(users, 'teamLead');
    render(
      <UserTable
        groups={groups}
        selectedEmails={new Set()}
        canToggleActive={() => true}
        canToggleAccepts={() => true}
        onSelect={noop}
        onOpen={noop}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    expect(screen.getByText('Brhamdev Sharma (2)')).toBeInTheDocument();
    expect(screen.getByText('Aarav Patel')).toBeInTheDocument();
    expect(screen.getByText('Priya Singh')).toBeInTheDocument();
  });

  it('does NOT render a group header when there is a single group keyed "all"/none', () => {
    const groups = groupUsers(users, 'none'); // → single group, key 'all', label 'All users'
    render(
      <UserTable
        groups={groups}
        selectedEmails={new Set()}
        canToggleActive={() => true}
        canToggleAccepts={() => true}
        onSelect={noop}
        onOpen={noop}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    expect(screen.queryByText(/All users/)).toBeNull();
    // rows still render
    expect(screen.getByText('Aarav Patel')).toBeInTheDocument();
  });

  it('clicking a row in the table calls onOpen with that user', () => {
    const onOpen = vi.fn();
    const groups = groupUsers(users, 'teamLead');
    render(
      <UserTable
        groups={groups}
        selectedEmails={new Set()}
        canToggleActive={() => true}
        canToggleAccepts={() => true}
        onSelect={noop}
        onOpen={onOpen}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    fireEvent.click(screen.getByText('Aarav Patel'));
    expect(onOpen).toHaveBeenCalledWith(users[0]);
  });

  it('passes per-user disabled state through canToggleActive', () => {
    const groups = groupUsers([users[0]], 'none');
    // Disabled toggles render a Tooltip, which needs the page-level
    // TooltipProvider (hoisted out of the row cells).
    render(
      <TooltipProvider>
        <UserTable
          groups={groups}
          selectedEmails={new Set()}
          canToggleActive={() => false}
          canToggleAccepts={() => true}
          onSelect={noop}
          onOpen={noop}
          onToggleActive={noop}
          onToggleAccepts={noop}
        />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText('Active')).toBeDisabled();
  });

  it('reflects selection via selectedEmails', () => {
    const groups = groupUsers([users[0]], 'none');
    render(
      <UserTable
        groups={groups}
        selectedEmails={new Set([users[0].email])}
        canToggleActive={() => true}
        canToggleAccepts={() => true}
        onSelect={noop}
        onOpen={noop}
        onToggleActive={noop}
        onToggleAccepts={noop}
      />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});
