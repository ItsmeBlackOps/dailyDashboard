import { useState, useEffect } from 'react';
import {
  UserPlus, RefreshCw, Mail, UserCog, Phone, FileCheck, GraduationCap,
  Calendar, Circle, Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import moment from 'moment-timezone';
import { useAuth, API_URL } from '@/hooks/useAuth';

// Matches the backend GET /api/candidates/:id/timeline event shape.
export interface TimelineEvent {
  id: string;
  ts: string;
  type: string;
  label: string;
  actor?: string;
  detail?: unknown;
  source: string;
}

interface CandidateTimelineProps {
  candidateId: string;
  refreshKey?: number;
}

// Per-type icon + accent colour. Falls back to a neutral dot for unknown types.
const ICONS: Record<string, { icon: LucideIcon; className: string }> = {
  created: { icon: UserPlus, className: 'text-primary' },
  status_changed: { icon: RefreshCw, className: 'text-violet-500' },
  assignment_email: { icon: Mail, className: 'text-blue-500' },
  field_changed: { icon: UserCog, className: 'text-sky-500' },
  call_attempt: { icon: Phone, className: 'text-green-500' },
  document_prepared: { icon: FileCheck, className: 'text-primary' },
  mock_interview: { icon: GraduationCap, className: 'text-violet-500' },
  task_created: { icon: UserPlus, className: 'text-blue-500' },
  task_recreated: { icon: RefreshCw, className: 'text-amber-500' },
  interview: { icon: Calendar, className: 'text-indigo-500' },
};

const DEFAULT_ICON = { icon: Circle, className: 'text-muted-foreground' };

function formatActor(actor?: string): string {
  if (!actor) return '';
  if (actor === 'system' || actor === 'system-backfill') return 'System';
  if (!actor.includes('@')) return actor;
  // Mirror the candidate page's display style: local-part → "First Last".
  return actor
    .split('@')[0]
    .split(/[._]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function CandidateTimeline({ candidateId, refreshKey }: CandidateTimelineProps) {
  const { authFetch } = useAuth();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!candidateId) return;
    let cancelled = false;

    setLoading(true);
    setError('');
    authFetch(`${API_URL}/api/candidates/${candidateId}/timeline`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.success && Array.isArray(json.timeline)) {
          setEvents(json.timeline);
        } else {
          setError(json?.error || 'Failed to load timeline');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load timeline');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [candidateId, refreshKey, authFetch]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <div className="text-destructive text-sm text-center py-4">{error}</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-muted-foreground text-center py-8 text-sm">
        No timeline events found.
      </div>
    );
  }

  // Server already sorts newest-first; render in received order.
  return (
    <div className="divide-y">
      {events.map((event) => {
        const { icon: Icon, className } = ICONS[event.type] ?? DEFAULT_ICON;
        const actor = formatActor(event.actor);
        return (
          <div key={event.id} className="flex gap-3 py-2">
            <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${className}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium break-words">{event.label}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {moment(event.ts).fromNow()}
                </span>
              </div>
              {actor && <div className="text-xs text-muted-foreground">{actor}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CandidateTimeline;
