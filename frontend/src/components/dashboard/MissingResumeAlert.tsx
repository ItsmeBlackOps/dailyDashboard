import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth, API_URL } from '@/hooks/useAuth';

interface MissingResumeCandidate {
  id: string;
  name: string;
  technology: string;
  recruiter: string;
  branch: string;
}

interface MissingResumeResponse {
  success: boolean;
  total: number;
  candidates: MissingResumeCandidate[];
}

const SESSION_KEY = 'missingResumeAlertDismissed';

// Marketing team — mm / mam / mlead / recruiter. Admin is excluded
// (manages globally, would be flooded). Matches backend role gate
// in candidateController.getMissingResumes.
const MARKETING_ROLES = new Set(['mm', 'mam', 'mlead', 'recruiter']);

/**
 * One-time per session prompt for marketing-team users with active
 * candidates that have no resume on file. Closing the dialog stores a
 * flag in sessionStorage so it doesn't pop again until the next login.
 */
export default function MissingResumeAlert() {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MissingResumeResponse | null>(null);

  // role is set once at signin — read it once on mount instead of every render.
  const role = useMemo(() => (localStorage.getItem('role') || '').trim().toLowerCase(), []);
  const isMarketing = MARKETING_ROLES.has(role);

  useEffect(() => {
    if (!isMarketing) return;
    if (sessionStorage.getItem(SESSION_KEY) === '1') return;

    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/candidates/missing-resumes`);
        if (!res.ok) return;
        const json = (await res.json()) as MissingResumeResponse;
        if (cancelled) return;
        if (json.total > 0) {
          setData(json);
          setOpen(true);
        }
      } catch {
        // silent — non-blocking
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isMarketing, authFetch]);

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setOpen(false);
  };

  const goToCandidate = (id: string) => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setOpen(false);
    navigate(`/candidate/${id}`);
  };

  const remaining = useMemo(() => {
    if (!data) return 0;
    return Math.max(0, data.total - (data.candidates?.length ?? 0));
  }, [data]);

  if (!isMarketing) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-aurora-amber" />
            {data?.total ?? 0} active candidate{(data?.total ?? 0) === 1 ? '' : 's'} need a resume
          </DialogTitle>
          <DialogDescription>
            Auto job-matching depends on the candidate's resume. Upload one to start
            receiving matched postings on their profile.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[320px] -mx-2 px-2">
          <ul className="divide-y">
            {(data?.candidates ?? []).map((c) => (
              <li key={c.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.name || '(unnamed)'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {c.technology || '—'} {c.branch ? `· ${c.branch}` : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => goToCandidate(c.id)}
                  className="shrink-0"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload
                </Button>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <p className="pt-2 text-[11px] text-muted-foreground text-center">
              + {remaining} more — open Branch Candidates to see the full list.
            </p>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" onClick={dismiss}>
            Remind me later
          </Button>
          <Button
            onClick={() => {
              sessionStorage.setItem(SESSION_KEY, '1');
              setOpen(false);
              navigate('/branch-candidates');
            }}
            className="bg-gradient-to-r from-aurora-violet to-aurora-cyan text-white"
          >
            Open Branch Candidates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
