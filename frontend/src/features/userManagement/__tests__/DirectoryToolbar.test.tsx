import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom polyfills Radix Select needs (pointer capture + scrollIntoView).
// Mirrors the pattern used by the other Select-driving tests in this repo.
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

// This repo's vitest config does not enable `globals`, so register cleanup.
afterEach(cleanup);

import { DirectoryToolbar, type DirectoryFilters } from '../DirectoryToolbar';

const baseFilters: DirectoryFilters = {
  role: 'all',
  team: 'all',
  active: 'all',
  acceptsTasks: 'all',
};

const renderToolbar = (overrides: Partial<React.ComponentProps<typeof DirectoryToolbar>> = {}) => {
  const props = {
    search: '',
    onSearch: vi.fn(),
    filters: baseFilters,
    onFilter: vi.fn(),
    groupBy: 'teamLead' as const,
    onGroupBy: vi.fn(),
    sort: 'name' as const,
    onSort: vi.fn(),
    canCreate: true,
    onAddUsers: vi.fn(),
    ...overrides,
  };
  render(<DirectoryToolbar {...props} />);
  return props;
};

describe('DirectoryToolbar', () => {
  it('typing in search calls onSearch with the new value', () => {
    const onSearch = vi.fn();
    renderToolbar({ onSearch });
    const input = screen.getByPlaceholderText('Search name or email');
    fireEvent.change(input, { target: { value: 'aarav' } });
    expect(onSearch).toHaveBeenCalledWith('aarav');
  });

  it('renders the current search value', () => {
    renderToolbar({ search: 'priya' });
    expect(screen.getByPlaceholderText('Search name or email')).toHaveValue('priya');
  });

  it('selecting a Role option calls onFilter with the merged filters', () => {
    const onFilter = vi.fn();
    renderToolbar({ onFilter });

    // The Role select is labelled for a11y; open it and pick "Recruiter".
    const roleTrigger = screen.getByLabelText('Filter by role');
    fireEvent.click(roleTrigger);
    fireEvent.click(screen.getByText('Recruiter'));

    expect(onFilter).toHaveBeenCalledWith({ ...baseFilters, role: 'recruiter' });
  });

  it('"Add users" button is shown when canCreate and calls onAddUsers', () => {
    const onAddUsers = vi.fn();
    renderToolbar({ canCreate: true, onAddUsers });
    const btn = screen.getByRole('button', { name: /add users/i });
    fireEvent.click(btn);
    expect(onAddUsers).toHaveBeenCalled();
  });

  it('"Add users" button is NOT rendered when canCreate is false', () => {
    renderToolbar({ canCreate: false });
    expect(screen.queryByRole('button', { name: /add users/i })).toBeNull();
  });
});
