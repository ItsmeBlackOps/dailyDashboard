/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AssignmentEmailModal from '../AssignmentEmailModal';
import type { CandidateAttachment } from '@/components/candidates/AttachmentZone';

// authFetch is built inside useAuth from auth context + localStorage; mock it
// so the modal's preview fetch is fully controlled by the test.
const authFetchMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch: authFetchMock }),
}));

// The modal sends delegated (like Interview Support): it acquires a Graph
// token and passes it as x-graph-access-token. Mock the hook so no MSAL
// provider is needed and the token is deterministic.
const acquireGraphMock = vi.fn().mockResolvedValue('graph-token-abc');
vi.mock('@/hooks/useGraphMailToken', () => ({
  useGraphMailToken: () => ({ acquireGraphAccessToken: acquireGraphMock }),
}));

// useToast is pulled in for the Send flow.
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Radix Dialog mounts pointer/observer primitives that jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
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

const ATTACHMENTS: CandidateAttachment[] = [
  {
    id: 'a1',
    filename: 'r.pdf',
    mimeType: 'application/pdf',
    size: 1234,
    s3Key: 'cand-1/r.pdf',
    url: 'https://x/r.pdf',
    uploadedAt: '2026-06-01T00:00:00.000Z',
    uploadedBy: 'rec@x.com',
  },
];

function renderModal() {
  return render(
    <AssignmentEmailModal
      open
      onOpenChange={() => {}}
      candidateId="cand-1"
      candidateName="Asha"
      technology="Software Developer"
      visaType="H1B"
      recruiterEmail="rec@x.com"
      teamLeadEmail="tl@x.com"
      attachments={ATTACHMENTS}
    />,
  );
}

describe('AssignmentEmailModal — server-accurate preview', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    acquireGraphMock.mockClear();
    acquireGraphMock.mockResolvedValue('graph-token-abc');
  });

  // No global afterEach is configured in vitest.config (globals: false), so
  // unmount the previous render or test 1's modal lingers in the DOM.
  afterEach(() => {
    cleanup();
  });

  it('renders To, CC chips (incl. Tushar), attachment filenames, and the body HTML from the preview', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        preview: {
          to: ['rec@x.com'],
          cc: ['tl@x.com', 'tushar.ahuja@silverspaceinc.com'],
          bcc: [],
          subject: 'Assignment: Asha',
          bodyHtml: '<p>Hi TL</p>',
          attachments: [{ id: 'a1', filename: 'r.pdf' }],
        },
      }),
    });

    renderModal();

    // To
    await waitFor(() => expect(screen.getByText('rec@x.com')).toBeInTheDocument());
    // CC chip incl. the permanent CC
    expect(screen.getByText('tushar.ahuja@silverspaceinc.com')).toBeInTheDocument();
    expect(screen.getByText('tl@x.com')).toBeInTheDocument();
    // Attachment filename from the preview list (appears in the preview panel)
    expect(screen.getAllByText('r.pdf').length).toBeGreaterThan(0);
    // Body HTML rendered
    expect(screen.getByText('Hi TL')).toBeInTheDocument();

    // It posted to the preview endpoint with the current draft.
    const [url, init] = authFetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/candidates/cand-1/assignment-email/preview');
    expect(init.method).toBe('POST');
    const sentBody = JSON.parse(init.body);
    expect(sentBody.attachmentIds).toEqual(['a1']);
  });

  it('shows the error and disables Send when the preview gate fails (400)', async () => {
    authFetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: 'At least one attachment is required',
      }),
    });

    renderModal();

    // The gate error replaces the preview (shown in both the recipients
    // summary and the body panel).
    await waitFor(() =>
      expect(
        screen.getAllByText(/At least one attachment is required/i).length,
      ).toBeGreaterThan(0),
    );

    const sendButton = screen.getByRole('button', { name: /Queue & Send|Send|Queueing/i });
    expect(sendButton).toBeDisabled();
  });

  it('acquires a Graph token and posts it as x-graph-access-token on send (delegated)', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/assignment-email/preview')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            preview: {
              to: ['rec@x.com'],
              cc: ['tl@x.com'],
              bcc: [],
              subject: 'Assignment: Asha',
              bodyHtml: '<p>Hi</p>',
              attachments: [{ id: 'a1', filename: 'r.pdf' }],
            },
          }),
        });
      }
      // /send-assignment-email
      return Promise.resolve({ ok: true, json: async () => ({ success: true, status: 'sent' }) });
    });

    renderModal();

    const sendButton = await screen.findByRole('button', { name: /^Send$/i });
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    fireEvent.click(sendButton);

    await waitFor(() => {
      const sendCall = authFetchMock.mock.calls.find((c) =>
        String(c[0]).includes('/send-assignment-email'),
      );
      expect(sendCall).toBeTruthy();
      expect(sendCall![1].headers['x-graph-access-token']).toBe('graph-token-abc');
    });
    expect(acquireGraphMock).toHaveBeenCalled();
  });
});
