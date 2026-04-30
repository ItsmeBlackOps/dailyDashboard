import { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** "compact" pads less; "default" centers vertically with breathing room. */
  size?: 'compact' | 'default';
}

/**
 * Aurora-themed empty state. Centred icon in a soft gradient ring,
 * title in foreground color, optional description + action.
 *
 * Use whenever a list / table / panel has nothing to render — replaces
 * plain "No data" text and gives users a hint about what to do next.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = 'default',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'compact' ? 'py-8 gap-2' : 'py-16 gap-3',
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          'flex items-center justify-center rounded-full',
          'bg-gradient-to-br from-aurora-violet/10 to-aurora-cyan/10',
          'ring-1 ring-aurora-violet/20',
          size === 'compact' ? 'h-10 w-10' : 'h-14 w-14'
        )}
      >
        <span className="text-aurora-violet">
          {icon ?? <Inbox className={size === 'compact' ? 'h-4 w-4' : 'h-6 w-6'} />}
        </span>
      </div>
      <p
        className={cn(
          'font-medium text-foreground',
          size === 'compact' ? 'text-sm' : 'text-[15px]'
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            'text-muted-foreground max-w-md',
            size === 'compact' ? 'text-xs' : 'text-sm leading-relaxed'
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
