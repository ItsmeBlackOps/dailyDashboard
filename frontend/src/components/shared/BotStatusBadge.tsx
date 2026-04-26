import { Badge } from '@/components/ui/badge';

interface BotStatusBadgeProps {
  status?: string;
  attempts?: number;
  error?: string | null;
}

const STATUS_MAP: Record<string, { label: string; className: string; emoji: string }> = {
  pending:          { label: 'Bot Pending',  className: 'bg-gray-100 text-gray-700 border-gray-300',         emoji: '🤖' },
  precheck_invited: { label: 'Pre-checking', className: 'bg-amber-100 text-amber-700 border-amber-300',      emoji: '🔍' },
  precheck_joined:  { label: 'Link OK',      className: 'bg-emerald-100 text-emerald-700 border-emerald-300', emoji: '✅' },
  precheck_failed:  { label: 'Link Bad',     className: 'bg-rose-100 text-rose-700 border-rose-300',          emoji: '⚠️' },
  main_invited:     { label: 'Bot Invited',  className: 'bg-blue-100 text-blue-700 border-blue-300',          emoji: '🤖' },
  main_joined:      { label: 'Recording',    className: 'bg-emerald-100 text-emerald-700 border-emerald-300', emoji: '🔴' },
  main_failed:      { label: 'Bot Failed',   className: 'bg-rose-100 text-rose-700 border-rose-300',          emoji: '❌' },
  completed:        { label: 'Recorded',     className: 'bg-emerald-100 text-emerald-700 border-emerald-300', emoji: '📼' },
};

export default function BotStatusBadge({ status, attempts, error }: BotStatusBadgeProps) {
  if (!status || status === 'pending') return null;
  const info = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const tooltip = error
    ? `${info.label} • ${error}`
    : `${info.label}${attempts ? ` (${attempts} attempts)` : ''}`;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${info.className}`} title={tooltip}>
      <span>{info.emoji}</span>
      <span>{info.label}</span>
    </Badge>
  );
}
