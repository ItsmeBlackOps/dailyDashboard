import { CheckCircle2, Circle } from 'lucide-react';

export interface MeetingStartedChipProps {
  started: boolean;
  startedBy?: string | null;
  startedAt?: string | null;
  status?: string | null;   // task status — chip hidden on Cancelled/Completed
  canMark: boolean;         // may the viewer mark it started?
  onMark: () => void;       // called on click when not started + canMark
}

const CLOSED_STATUSES = ['cancelled', 'completed'];

export function MeetingStartedChip({ started, startedBy, startedAt, status, canMark, onMark }: MeetingStartedChipProps) {
  if (CLOSED_STATUSES.includes((status || '').toLowerCase())) return null;

  if (started) {
    const label = startedAt ? `Expert joined at ${startedAt}` : 'Meeting started';
    return (
      <span title={label} role="img" aria-label={label} className="inline-flex items-center">
        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" aria-hidden="true" />
      </span>
    );
  }

  if (canMark) {
    return (
      <button
        type="button"
        onClick={onMark}
        title="Mark meeting started"
        aria-label="Mark meeting started"
        className="inline-flex items-center rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Circle className="h-5 w-5 shrink-0" aria-hidden="true" />
      </button>
    );
  }

  return (
    <span title="Meeting not started yet" role="img" aria-label="Meeting not started yet" className="inline-flex items-center">
      <Circle className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
    </span>
  );
}
