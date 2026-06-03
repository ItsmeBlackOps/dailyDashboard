/* @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect, useRef, useState } from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Vitest does not auto-register Testing Library cleanup; do it ourselves so a
// dialog rendered in one test does not leak into the next.
afterEach(() => cleanup());
import {
  MemoryRouter,
  Routes,
  Route,
  useSearchParams,
  useLocation,
} from 'react-router-dom';

/**
 * Deep-link (?new=1) → auto-open the Add Candidate form.
 *
 * BranchCandidates is a ~5k-line component that, on mount, opens a socket.io
 * connection and consumes seven context/hook providers (useAuth, useToast,
 * useNotifications, useUserProfile, useMsal, usePostHog, plus SOCKET_URL).
 * Mounting it whole here would require a large, brittle mock scaffold that
 * could easily mask the very behavior under test, so — per the plan's
 * fallback guidance — we exercise the deep-link effect in isolation using a
 * real react-router-dom MemoryRouter.
 *
 * The harness below reproduces the EXACT effect added to BranchCandidates
 * (see src/components/dashboard/BranchCandidates.tsx, just after the
 * `isCreateOpen` state): read `?new=1` once via a useRef guard, flip the
 * create dialog open, then strip the `new` param with
 * `setSearchParams(next, { replace: true })`. Keep this harness in sync if
 * that effect changes.
 */
function DeepLinkHarness({ onOpen }: { onOpen: () => void }) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const newParamHandled = useRef(false);
  useEffect(() => {
    if (newParamHandled.current) return;
    if (searchParams.get('new') === '1') {
      newParamHandled.current = true;
      setIsCreateOpen(true);
      onOpen();
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, onOpen]);

  const location = useLocation();
  return (
    <div>
      <span data-testid="search">{location.search}</span>
      {isCreateOpen ? <div role="dialog">Add Candidate</div> : null}
    </div>
  );
}

describe('BranchCandidates deep-link (?new=1)', () => {
  it('opens the Add Candidate dialog and strips the ?new param', async () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/branch-candidates?new=1']}>
        <Routes>
          <Route
            path="/branch-candidates"
            element={<DeepLinkHarness onOpen={onOpen} />}
          />
        </Routes>
      </MemoryRouter>
    );

    // Dialog auto-opens from the deep link.
    expect(await screen.findByText('Add Candidate')).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The one-shot effect strips `new` so a refresh/back doesn't reopen it.
    await waitFor(() => {
      expect(screen.getByTestId('search').textContent).toBe('');
    });
    // Guarded by the ref — it never fires twice.
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not open the dialog without ?new=1', () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={['/branch-candidates']}>
        <Routes>
          <Route
            path="/branch-candidates"
            element={<DeepLinkHarness onOpen={onOpen} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText('Add Candidate')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
