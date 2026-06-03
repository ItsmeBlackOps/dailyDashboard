/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Auto-send the §6.2 Assignment Email on a successful create.
 *
 * BranchCandidates is a ~5k-line component that, on mount, opens a socket.io
 * connection and consumes seven context/hook providers (useAuth, useToast,
 * useNotifications, useUserProfile, useMsal, usePostHog, plus SOCKET_URL).
 * The post-create orchestration also reads a dozen pieces of component state
 * (createResumeFile, createAdditionalFiles, createNotes, socket, authFetch,
 * toast, acquireGraphAccessToken, …). Mounting the whole component to drive
 * one socket callback would require a large, brittle mock scaffold that could
 * easily mask the very behavior under test, and extracting the closure into a
 * standalone helper is far more than the "a few lines" the plan permits. So —
 * per the plan's fallback guidance and matching the sibling deep-link test
 * (BranchCandidates.deeplink.test.tsx) — we reproduce the EXACT post-create
 * sequence here in a harness.
 *
 * HARNESS — MUST STAY IN SYNC WITH SOURCE.
 * `runPostCreate` below is a line-for-line mirror of the `socket.emit(
 * 'createCandidate', payload, async (response) => { … })` callback inside
 * `handleCreateCandidate` in
 * src/components/dashboard/BranchCandidates.tsx (~lines 3398–3500):
 *   1) POST /api/candidates/:id/attachments → on ok, capture resumeAttachmentId
 *      then POST /attachments/:aid/set-as-resume,
 *   2) POST each additional file to /attachments/additional,
 *   3) acquire the Graph token (best-effort) then POST /send-assignment-email
 *      with the `x-graph-access-token` header and body
 *      { attachmentIds: [resumeAttachmentId] }; on a non-OK response show a
 *      destructive "Assignment email not sent" toast WITHOUT throwing and
 *      WITHOUT blocking the "Candidate created" success,
 *   4) optional note via the addResumeComment socket event,
 *   then the unconditional "Candidate created" success toast.
 * If that source flow changes, update this harness to match.
 */

const API_URL = 'http://localhost:3004';

interface HarnessDeps {
  socket: { emit: (event: string, ...args: any[]) => void };
  authFetch: (url: string, init?: any) => Promise<Response>;
  acquireGraphAccessToken: () => Promise<string>;
  toast: (opts: { title: string; description?: string; variant?: string }) => void;
  createResumeFile: File | null;
  createAdditionalFiles: File[];
  createNotes: string;
  resetCreateState: () => void;
  fetchCandidates: () => void;
  setCreateError: (msg: string) => void;
  setCreating: (v: boolean) => void;
}

/**
 * Verbatim mirror of the createCandidate socket callback. Given the already
 * built `payload`, emit the create and run the post-create enrichment exactly
 * as the source does.
 */
function runPostCreate(deps: HarnessDeps, payload: Record<string, unknown>): Promise<void> {
  const {
    socket,
    authFetch,
    acquireGraphAccessToken,
    toast,
    createResumeFile,
    createAdditionalFiles,
    createNotes,
    resetCreateState,
    fetchCandidates,
    setCreateError,
    setCreating,
  } = deps;

  return new Promise<void>((resolve) => {
    socket.emit('createCandidate', payload, async (response: any) => {
      if (!response?.success) {
        const details = Array.isArray(response?.details) ? response.details.join(', ') : '';
        setCreateError(response?.error || details || 'Unable to create candidate');
        setCreating(false);
        resolve();
        return;
      }

      const candidateId = String(response?.candidate?.id || response?.candidate?._id || '');

      // Post-create enrichment. The candidate is already saved, so each
      // step is non-blocking — a failure only surfaces a toast.
      if (candidateId) {
        let resumeAttachmentId = '';
        // 1) Persist the resume as an attachment (so the assignment email
        //    can carry it) and mark it the canonical resume.
        try {
          if (createResumeFile) {
            const fd = new FormData();
            fd.append('file', createResumeFile);
            const r = await authFetch(`${API_URL}/api/candidates/${candidateId}/attachments`, { method: 'POST', body: fd });
            const j = await r.json();
            if (r.ok && j?.success && j?.attachment?.id) {
              resumeAttachmentId = String(j.attachment.id);
              await authFetch(`${API_URL}/api/candidates/${candidateId}/attachments/${resumeAttachmentId}/set-as-resume`, { method: 'POST' });
            }
          }
        } catch { /* non-blocking */ }

        // 2) Upload additional attachments (any format).
        for (const file of createAdditionalFiles) {
          try {
            const fd = new FormData();
            fd.append('file', file);
            await authFetch(`${API_URL}/api/candidates/${candidateId}/attachments/additional`, { method: 'POST', body: fd });
          } catch { /* non-blocking */ }
        }

        // 3) Send the §6.2 Assignment Email from the creator's own mailbox
        //    (delegated, like Interview Support) by passing the Graph token.
        //    The server falls back to the async outbox if that send fails,
        //    so the email is never silently lost.
        try {
          let graphToken = '';
          try {
            graphToken = await acquireGraphAccessToken();
          } catch {
            /* no delegated token → server enqueues via the outbox */
          }
          const r = await authFetch(`${API_URL}/api/candidates/${candidateId}/send-assignment-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(graphToken ? { 'x-graph-access-token': graphToken } : {})
            },
            body: JSON.stringify(resumeAttachmentId ? { attachmentIds: [resumeAttachmentId] } : {})
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            toast({
              title: 'Assignment email not sent',
              description: j?.error || 'You can send it from the candidate page.',
              variant: 'destructive'
            });
          }
        } catch {
          toast({
            title: 'Assignment email not queued',
            description: 'You can send it from the candidate page.',
            variant: 'destructive'
          });
        }

        // 4) Save the note as a candidatecomments type='notes' entry.
        if (createNotes.trim()) {
          try {
            socket.emit('addResumeComment', { candidateId, content: createNotes.trim(), type: 'notes' }, () => {});
          } catch { /* non-blocking */ }
        }
      }

      toast({
        title: 'Candidate created',
        description: 'Assignment email sent to the Team Lead. Candidate sent to admin alerts for expert assignment.'
      });

      resetCreateState();
      fetchCandidates();
      resolve();
    });
  });
}

/** A tiny socket double that invokes the createCandidate ack with `ackResponse`. */
function makeSocket(ackResponse: unknown) {
  const emit = vi.fn((event: string, _payload: unknown, cb?: (r: unknown) => void) => {
    if (event === 'createCandidate' && typeof cb === 'function') {
      cb(ackResponse);
    }
    // addResumeComment passes a noop ack; nothing to do.
  });
  return { emit };
}

/** Build a jsonable Response double for authFetch. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

function baseDeps(overrides: Partial<HarnessDeps> = {}): HarnessDeps {
  return {
    socket: makeSocket({ success: true, candidate: { id: 'cand-123' } }),
    authFetch: vi.fn(),
    acquireGraphAccessToken: vi.fn(async () => 'graph-token-xyz'),
    toast: vi.fn(),
    createResumeFile: new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' }),
    createAdditionalFiles: [],
    createNotes: '',
    resetCreateState: vi.fn(),
    fetchCandidates: vi.fn(),
    setCreateError: vi.fn(),
    setCreating: vi.fn(),
    ...overrides,
  };
}

describe('BranchCandidates post-create auto-send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('on a successful create, attaches the resume, sets it as resume, and sends the assignment email with attachmentIds + Graph token', async () => {
    const authFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/attachments')) {
        return jsonResponse({ success: true, attachment: { id: 'att-9' } });
      }
      // set-as-resume + send-assignment-email both succeed.
      return jsonResponse({ success: true });
    });

    const deps = baseDeps({ authFetch });

    await runPostCreate(deps, { name: 'Asha Rao' });

    const calls = authFetch.mock.calls.map((c) => String(c[0]));
    // 1) resume attached, 2) set-as-resume, 3) assignment email sent.
    expect(calls).toContain(`${API_URL}/api/candidates/cand-123/attachments`);
    expect(calls).toContain(`${API_URL}/api/candidates/cand-123/attachments/att-9/set-as-resume`);
    expect(calls).toContain(`${API_URL}/api/candidates/cand-123/send-assignment-email`);

    // The assignment-email POST carries the resolved resume attachment id and
    // the delegated Graph token header.
    const sendCall = authFetch.mock.calls.find((c) => String(c[0]).endsWith('/send-assignment-email'));
    expect(sendCall).toBeTruthy();
    const sendInit = sendCall![1] as RequestInit;
    expect(sendInit.method).toBe('POST');
    expect((sendInit.headers as Record<string, string>)['x-graph-access-token']).toBe('graph-token-xyz');
    expect(JSON.parse(String(sendInit.body))).toEqual({ attachmentIds: ['att-9'] });

    // Graph token was requested.
    expect(deps.acquireGraphAccessToken).toHaveBeenCalledTimes(1);

    // The create itself succeeded: success toast shown, no error, state reset.
    const toastTitles = (deps.toast as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].title);
    expect(toastTitles).toContain('Candidate created');
    expect(toastTitles).not.toContain('Assignment email not sent');
    expect(deps.setCreateError).not.toHaveBeenCalled();
    expect(deps.resetCreateState).toHaveBeenCalledTimes(1);
    expect(deps.fetchCandidates).toHaveBeenCalledTimes(1);
  });

  it('a non-OK /send-assignment-email response shows the destructive "Assignment email not sent" toast WITHOUT blocking the "Candidate created" success', async () => {
    const authFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/attachments')) {
        return jsonResponse({ success: true, attachment: { id: 'att-9' } });
      }
      if (url.endsWith('/send-assignment-email')) {
        // Server gate failure (e.g. token rejected / no attachment).
        return jsonResponse({ error: 'Invalid token' }, false);
      }
      return jsonResponse({ success: true });
    });

    const deps = baseDeps({ authFetch });

    // Must not throw despite the failed send.
    await expect(runPostCreate(deps, { name: 'Asha Rao' })).resolves.toBeUndefined();

    const toastCalls = (deps.toast as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const notSent = toastCalls.find((t) => t.title === 'Assignment email not sent');
    expect(notSent).toBeTruthy();
    expect(notSent!.variant).toBe('destructive');
    expect(notSent!.description).toBe('Invalid token');

    // The create success is NOT blocked by the failed send.
    expect(toastCalls.some((t) => t.title === 'Candidate created')).toBe(true);
    expect(deps.resetCreateState).toHaveBeenCalledTimes(1);
    expect(deps.fetchCandidates).toHaveBeenCalledTimes(1);
  });

  it('still sends (without attachmentIds) and does not throw when the resume attachment fails to persist', async () => {
    const authFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/attachments')) {
        // Attachment persist failed → no resumeAttachmentId captured.
        return jsonResponse({ success: false }, false);
      }
      return jsonResponse({ success: true });
    });

    const deps = baseDeps({ authFetch });

    await expect(runPostCreate(deps, { name: 'Asha Rao' })).resolves.toBeUndefined();

    const calls = authFetch.mock.calls.map((c) => String(c[0]));
    // set-as-resume is skipped when no attachment id came back.
    expect(calls.some((u) => u.includes('/set-as-resume'))).toBe(false);
    // The assignment email is still attempted, with an empty body (no ids).
    const sendCall = authFetch.mock.calls.find((c) => String(c[0]).endsWith('/send-assignment-email'));
    expect(sendCall).toBeTruthy();
    expect(JSON.parse(String((sendCall![1] as RequestInit).body))).toEqual({});
  });

  it('falls back to the outbox (no Graph header) when the token cannot be acquired, and still sends', async () => {
    const authFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/attachments')) {
        return jsonResponse({ success: true, attachment: { id: 'att-9' } });
      }
      return jsonResponse({ success: true });
    });

    const deps = baseDeps({
      authFetch,
      acquireGraphAccessToken: vi.fn(async () => {
        throw new Error('no delegated token');
      }),
    });

    await expect(runPostCreate(deps, { name: 'Asha Rao' })).resolves.toBeUndefined();

    const sendCall = authFetch.mock.calls.find((c) => String(c[0]).endsWith('/send-assignment-email'));
    expect(sendCall).toBeTruthy();
    const headers = (sendCall![1] as RequestInit).headers as Record<string, string>;
    // No token → no Graph header (server enqueues via the outbox).
    expect(headers['x-graph-access-token']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    // The send still happened and the create succeeded.
    const toastTitles = (deps.toast as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].title);
    expect(toastTitles).toContain('Candidate created');
  });

  it('surfaces a create failure (no enrichment, no success toast)', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ success: true }));
    const deps = baseDeps({
      socket: makeSocket({ success: false, error: 'Visa Type is required' }),
      authFetch,
    });

    await runPostCreate(deps, { name: 'Asha Rao' });

    expect(deps.setCreateError).toHaveBeenCalledWith('Visa Type is required');
    expect(deps.setCreating).toHaveBeenCalledWith(false);
    // No enrichment calls and no success toast on a failed create.
    expect(authFetch).not.toHaveBeenCalled();
    const toastTitles = (deps.toast as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].title);
    expect(toastTitles).not.toContain('Candidate created');
  });
});
