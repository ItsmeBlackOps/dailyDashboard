/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = function () {};
}
if (!window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = function () { return false; };
}
if (!window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = function () {};
}

// Stable auth value — a fresh authFetch per render retriggers data
// effects forever (render loop -> worker OOM).
const stableAuth = vi.hoisted(() => ({ authFetch: () => Promise.resolve(new Response('{}')) }));
vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => stableAuth,
}));

const api = vi.hoisted(() => ({
  fetchEligible: vi.fn(),
  grantDelegation: vi.fn(async () => ({ success: true, delegation: { status: 'pending' } })),
}));

vi.mock('@/lib/delegationApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/delegationApi')>();
  return { ...actual, ...api };
});

import { HandOffDialog } from '../HandOffDialog';

const TASK = { taskId: 't-main', subject: 'Interview Support - Venkata Kaseeswar - 2:00 PM' };
const OTHER = { taskId: 't-extra', subject: 'Interview Support - Allaudheen Shaik - 4:00 PM' };

describe('HandOffDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchEligible.mockResolvedValue({
      success: true,
      delegates: [{ email: 'utsa.maiti@vizvainc.com', role: 'user', team: 'technical', teamLead: 'Anusree Vasudevan' }],
      myPeople: [], deptExperts: [], transferTargets: [],
      actorRole: 'user', actorTeam: 'technical',
    });
  });

  afterEach(cleanup);

  it('hands off the launched task plus any checked extras as one tasks-scope grant', async () => {
    render(
      <HandOffDialog open task={TASK} myOtherTasks={[OTHER]} onClose={() => {}} />,
    );

    expect(await screen.findByText(TASK.subject)).toBeInTheDocument();

    const trigger = screen.getByLabelText('Teammate');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: /Utsa Maiti/ }));

    fireEvent.click(screen.getByLabelText(OTHER.subject));
    expect(screen.getByText(/Utsa Maiti will cover 2 of your tasks/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^hand off$/i }));
    await waitFor(() => expect(api.grantDelegation).toHaveBeenCalled());
    const [, , payload] = api.grantDelegation.mock.calls[0];
    expect(payload).toMatchObject({
      delegateEmail: 'utsa.maiti@vizvainc.com',
      scope: 'tasks',
    });
    expect(payload.taskIds.sort()).toEqual(['t-extra', 't-main']);
  });

  it('disables Hand off until a teammate is picked', async () => {
    render(<HandOffDialog open task={TASK} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /^hand off$/i })).toBeDisabled();
  });
});
