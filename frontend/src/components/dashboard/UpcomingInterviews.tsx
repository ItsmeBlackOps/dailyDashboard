import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, ChevronRight, Video } from 'lucide-react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { isTechnicalTeam } from '@/lib/technicalTeam';
import { TaskSheet } from '@/components/shared/TaskSheet';

// Dashboard strip: interviews starting within ~20 minutes (plus a short
// overdue grace, server-side) that nobody has marked started yet. Every
// role sees the same list; technical roles get a blinking treatment so a
// missed start is impossible to overlook. Renders nothing when the window
// is empty.

interface UpcomingTask {
  taskId: string;
  candidateName: string;
  role: string;
  client: string;
  round: string;
  status: string;
  interviewStartAt: string | null;
  interviewStartEst: string | null;
  assignedTo: string;
  hasMeetingLink: boolean;
}

const POLL_MS = 30_000;

function formatEmail(email: string) {
  if (!email) return '';
  if (!email.includes('@')) return email;
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

export function relativeLabel(iso: string | null, nowMs: number): { text: string; overdue: boolean } {
  if (!iso) return { text: '', overdue: false };
  const mins = Math.round((new Date(iso).getTime() - nowMs) / 60000);
  if (mins > 0) return { text: `in ${mins} min`, overdue: false };
  if (mins === 0) return { text: 'now', overdue: true };
  return { text: `${-mins} min overdue`, overdue: true };
}

export function UpcomingInterviews() {
  const { user, authFetch } = useAuth();
  const technical = isTechnicalTeam(user?.role ?? localStorage.getItem('role'));
  const [tasks, setTasks] = useState<UpcomingTask[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const load = useCallback(() => {
    authFetch(`${API_URL}/api/tasks/upcoming`)
      .then((res) => res.json())
      .then((json) => {
        if (json?.success && Array.isArray(json.tasks)) {
          setTasks(json.tasks);
          setNowMs(Date.now());
        }
      })
      .catch(() => {
        /* transient — next poll retries */
      });
  }, [authFetch]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  if (tasks.length === 0) return null;

  return (
    <div className="px-4 md:px-6 pt-3">
      <div
        className={`rounded-lg border p-3 ${
          technical
            ? 'border-rose-400/60 ring-1 ring-rose-400/40 bg-rose-500/[0.03]'
            : 'border-amber-300/70 bg-amber-500/[0.04]'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          {technical ? (
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>
          ) : (
            <AlarmClock className="h-4 w-4 text-amber-600" />
          )}
          <span className={`text-sm font-semibold ${technical ? 'text-rose-600 dark:text-rose-400' : ''}`}>
            Starting soon — not yet started
          </span>
          <span
            className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
              technical ? 'bg-rose-500 text-white' : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            }`}
          >
            {tasks.length}
          </span>
        </div>

        <div className="divide-y">
          {tasks.map((t) => {
            const rel = relativeLabel(t.interviewStartAt, nowMs);
            return (
              <div
                key={t.taskId}
                role="button"
                tabIndex={0}
                aria-label={`View task — ${t.candidateName}`}
                className="flex items-center gap-3 py-2 cursor-pointer rounded -mx-1.5 px-1.5 transition-colors hover:bg-muted/50"
                onClick={() => setSelectedTaskId(t.taskId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedTaskId(t.taskId);
                  }
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {t.candidateName}
                    {(t.role || t.client) && (
                      <span className="text-muted-foreground font-normal">
                        {' '}— {[t.role, t.client].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {t.interviewStartEst && <span>{t.interviewStartEst} EST</span>}
                    {t.assignedTo && <span>· {formatEmail(t.assignedTo)}</span>}
                    {t.hasMeetingLink && <Video className="h-3 w-3" aria-label="Has meeting link" />}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 whitespace-nowrap ${
                    technical
                      ? `animate-pulse ${
                          rel.overdue
                            ? 'border-rose-400/60 bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : 'border-amber-400/60 bg-amber-500/15 text-amber-700 dark:text-amber-400'
                        }`
                      : rel.overdue
                        ? 'border-rose-300/60 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        : 'border-amber-300/60 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {rel.text}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              </div>
            );
          })}
        </div>
      </div>

      <TaskSheet taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
    </div>
  );
}

export default UpcomingInterviews;
