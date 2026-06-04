import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom polyfills for any Radix Select rendered by the inline controls.
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

// vitest config does not enable globals → register cleanup manually.
afterEach(cleanup);

import { BulkActionBar } from '../BulkActionBar';

describe('BulkActionBar', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(
      <BulkActionBar count={0} selectedRoles={[]} actorRole="admin" onApply={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count', () => {
    render(
      <BulkActionBar count={2} selectedRoles={['recruiter']} actorRole="admin" onApply={vi.fn()} />,
    );
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('"Set active" calls onApply({ active: true })', () => {
    const onApply = vi.fn();
    render(
      <BulkActionBar count={2} selectedRoles={['recruiter']} actorRole="admin" onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /set active/i }));
    expect(onApply).toHaveBeenCalledWith({ active: true });
  });

  it('"Set inactive" calls onApply({ active: false })', () => {
    const onApply = vi.fn();
    render(
      <BulkActionBar count={2} selectedRoles={['recruiter']} actorRole="mm" onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /set inactive/i }));
    expect(onApply).toHaveBeenCalledWith({ active: false });
  });

  it('shows "Change role" when every selected role is assignable by the actor', () => {
    // canAssign('mm') = ['mam','mlead','recruiter'] ⊇ ['recruiter']
    render(
      <BulkActionBar count={1} selectedRoles={['recruiter']} actorRole="mm" onApply={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /change role/i })).toBeInTheDocument();
  });

  it('hides "Change role" when a selected role is NOT assignable by the actor', () => {
    // canAssign('mam') = ['mlead','recruiter']; 'mam' is not in it → hidden.
    render(
      <BulkActionBar
        count={2}
        selectedRoles={['recruiter', 'mam']}
        actorRole="mam"
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /change role/i })).toBeNull();
  });

  it('always renders the team-lead and manager bulk actions', () => {
    render(
      <BulkActionBar count={1} selectedRoles={['user']} actorRole="am" onApply={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /change team lead/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change manager/i })).toBeInTheDocument();
  });

  it('Change team lead → inline input + Apply calls onApply({ teamLead })', () => {
    const onApply = vi.fn();
    render(
      <BulkActionBar count={2} selectedRoles={['recruiter']} actorRole="mm" onApply={onApply} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /change team lead/i }));
    const input = screen.getByLabelText('New team lead');
    fireEvent.change(input, { target: { value: 'Brhamdev Sharma' } });
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onApply).toHaveBeenCalledWith({ teamLead: 'Brhamdev Sharma' });
  });
});
