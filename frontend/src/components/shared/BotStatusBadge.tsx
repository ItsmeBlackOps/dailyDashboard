import { Badge } from '@/components/ui/badge';

interface BotStatusBadgeProps {
  status?: string;
  attempts?: number;
  error?: string | null;
}

const STATUS_MAP: Record<string, { label: string; className: string; emoji: string }> = {
  pending:          { label: 'Bot Pending',  className: 'bg-muted/50 text-muted-foreground border-border',                        emoji: '🤖' },
  precheck_invited: { label: 'Pre-checking', className: 'bg-aurora-amber/15 text-aurora-amber border-aurora-amber/30',          emoji: '🔍' },
  precheck_joined:  { label: 'Link OK',      className: 'bg-aurora-emerald/15 text-aurora-emerald border-aurora-emerald/30',    emoji: '✅' },
  precheck_failed:  { label: 'Link Bad',     className: 'bg-aurora-rose/15 text-aurora-rose border-aurora-rose/30',             emoji: '⚠️' },
  main_invited:     { label: 'Bot Invited',  className: 'bg-accent text-primary border-primary/30',                             emoji: '🤖' },
  main_joined:      { label: 'Recording',    className: 'bg-aurora-emerald/15 text-aurora-emerald border-aurora-emerald/30',    emoji: '🔴' },
  main_failed:      { label: 'Bot Failed',   className: 'bg-aurora-rose/15 text-aurora-rose border-aurora-rose/30',             emoji: '❌' },
  completed:        { label: 'Recorded',     className: 'bg-aurora-emerald/15 text-aurora-emerald border-aurora-emerald/30',    emoji: '📼' },
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
