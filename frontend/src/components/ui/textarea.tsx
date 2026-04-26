import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-white/10 dark:border-white/10 ' +
        'bg-white/5 dark:bg-aurora-ink2/40 backdrop-blur-sm px-3 py-2 text-sm ' +
        'font-sans tracking-tight ' +
        'ring-offset-background ' +
        'placeholder:text-muted-foreground/60 ' +
        'transition-[box-shadow,border-color] duration-200 ' +
        'focus-visible:outline-none focus-visible:border-aurora-violet/50 ' +
        'focus-visible:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35),0_0_0_4px_rgba(139,92,246,0.10)] ' +
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
