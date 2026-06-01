import { useCallback, useMemo, useRef, useState } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Download,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File,
  Paperclip,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';

// PRT Phase 2: Attachment Zone for the candidate detail page.
// Permissions are enforced server-side; the UI mirrors the same role
// gating so non-marketing readers don't see upload / delete controls.
//
// Allowed MIME types match storageService.ATTACHMENT_MIME_MAP exactly.
const PRT_ATTACHMENT_MIME_VALUES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
] as const;
const PRT_ATTACHMENT_ACCEPT_ATTR = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg';
const PRT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const MARKETING_WRITE_ROLES = new Set(['admin', 'mm', 'mam', 'mlead', 'recruiter']);

export interface CandidateAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  s3Key: string;
  url: string;
  uploadedAt: string | Date;
  uploadedBy: string;
}

interface AttachmentZoneProps {
  candidateId: string;
  attachments: CandidateAttachment[];
  resumeLink: string | null | undefined;
  /** Called after every mutation so the parent can re-fetch the candidate. */
  onChange: () => void;
}

function iconForMime(mime: string) {
  if (mime === 'application/pdf') return FileText;
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.endsWith('spreadsheetml.sheet')) return FileSpreadsheet;
  if (mime.endsWith('wordprocessingml.document')) return FileText;
  return File;
}

function formatBytes(b: number) {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(ts: string | Date) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function AttachmentZone({
  candidateId,
  attachments,
  resumeLink,
  onChange,
}: AttachmentZoneProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Role gate (mirrors the backend PRT_ATTACHMENT_ROLES). Read-only viewers
  // (am/lead/expert/user) still see the list but no controls.
  const role = useMemo(
    () => (localStorage.getItem('role') || '').trim().toLowerCase(),
    [],
  );
  const canManage = MARKETING_WRITE_ROLES.has(role);

  const refresh = useCallback(() => {
    onChange();
  }, [onChange]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file) return;
      if (!PRT_ATTACHMENT_MIME_VALUES.includes(file.type as never)) {
        toast({
          title: 'Unsupported file type',
          description: 'Allowed: PDF, DOCX, XLSX, PNG, JPEG.',
          variant: 'destructive',
        });
        return;
      }
      if (file.size > PRT_ATTACHMENT_MAX_BYTES) {
        toast({
          title: 'File too large',
          description: 'Maximum size is 10 MB.',
          variant: 'destructive',
        });
        return;
      }

      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const resp = await authFetch(
          `${API_URL}/api/candidates/${candidateId}/attachments`,
          { method: 'POST', body: fd },
        );
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.success) {
          throw new Error(json.error || 'Unable to upload attachment');
        }
        toast({ title: 'Attachment uploaded' });
        refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        toast({ title: 'Upload failed', description: message, variant: 'destructive' });
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [authFetch, candidateId, refresh, toast],
  );

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      setBusyId(attachmentId);
      try {
        const resp = await authFetch(
          `${API_URL}/api/candidates/${candidateId}/attachments/${attachmentId}`,
          { method: 'DELETE' },
        );
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.success) {
          throw new Error(json.error || 'Unable to remove attachment');
        }
        toast({ title: 'Attachment removed' });
        refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Remove failed';
        toast({ title: 'Remove failed', description: message, variant: 'destructive' });
      } finally {
        setBusyId(null);
      }
    },
    [authFetch, candidateId, refresh, toast],
  );

  const setAsResume = useCallback(
    async (attachmentId: string) => {
      setBusyId(attachmentId);
      try {
        const resp = await authFetch(
          `${API_URL}/api/candidates/${candidateId}/attachments/${attachmentId}/set-as-resume`,
          { method: 'POST' },
        );
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json.success) {
          throw new Error(json.error || 'Unable to set as resume');
        }
        toast({ title: 'Resume updated' });
        refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Update failed';
        toast({ title: 'Update failed', description: message, variant: 'destructive' });
      } finally {
        setBusyId(null);
      }
    },
    [authFetch, candidateId, refresh, toast],
  );

  // Streaming-proxy download via authFetch → blob → object URL. We do
  // this so the request carries the JWT and the controller's scope
  // check still applies; window.open on the public URL would bypass auth.
  const downloadAttachment = useCallback(
    async (att: CandidateAttachment) => {
      try {
        const resp = await authFetch(
          `${API_URL}/api/candidates/${candidateId}/attachments/${att.id}/download`,
        );
        if (!resp.ok) {
          throw new Error('Unable to download attachment');
        }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = att.filename || 'attachment';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Download failed';
        toast({ title: 'Download failed', description: message, variant: 'destructive' });
      }
    },
    [authFetch, candidateId, toast],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOver(false);
      if (!canManage) return;
      const file = event.dataTransfer.files?.[0];
      if (file) uploadFile(file);
    },
    [canManage, uploadFile],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Paperclip className="h-4 w-4" /> Attachments
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-5 pt-1 space-y-3">
        {canManage && (
          <div
            role="region"
            aria-label="Attachment upload area"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`rounded-md border border-dashed p-4 text-center text-xs ${dragOver ? 'bg-muted/60 border-primary' : 'bg-muted/20'} ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <Upload className="h-5 w-5 mx-auto mb-1 text-muted-foreground" aria-hidden="true" />
            <p>
              Drop a file here or{' '}
              <button
                type="button"
                className="underline text-primary"
                onClick={() => inputRef.current?.click()}
                aria-label="Browse for an attachment to upload"
              >
                browse
              </button>
            </p>
            <p className="text-muted-foreground">PDF, DOCX, XLSX, PNG, JPEG — max 10 MB</p>
            <input
              ref={inputRef}
              type="file"
              accept={PRT_ATTACHMENT_ACCEPT_ATTR}
              className="hidden"
              aria-label="Attachment file picker"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
              }}
            />
            {uploading && <p className="mt-1 text-muted-foreground" role="status">Uploading…</p>}
          </div>
        )}

        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No attachments yet.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((att) => {
              const Icon = iconForMime(att.mimeType || '');
              const isResume = Boolean(resumeLink && att.url && resumeLink === att.url);
              const isPdf = (att.mimeType || '').toLowerCase() === 'application/pdf';
              const busy = busyId === att.id;
              return (
                <li
                  key={att.id}
                  className="flex items-center gap-2 rounded border p-2 text-xs"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 truncate">
                      <span className="truncate font-medium">{att.filename}</span>
                      {isResume && (
                        <span
                          className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                          title="Set as canonical resume — used by Resume Forge AI"
                        >
                          Resume
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      {formatBytes(att.size)} · {formatTimestamp(att.uploadedAt)} ·{' '}
                      {att.uploadedBy}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    title="Download"
                    aria-label={`Download ${att.filename}`}
                    onClick={() => downloadAttachment(att)}
                    disabled={busy}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  {canManage && isPdf && !isResume && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Set as canonical resume"
                      aria-label={`Set ${att.filename} as the canonical resume`}
                      onClick={() => setAsResume(att.id)}
                      disabled={busy}
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Remove"
                      aria-label={`Remove ${att.filename}`}
                      onClick={() => removeAttachment(att.id)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
