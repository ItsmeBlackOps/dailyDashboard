import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium font-sans tracking-tight ring-offset-background transition-[box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora-violet/60 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 active:translate-y-[0.5px] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'text-white border border-white/20 bg-[linear-gradient(120deg,#8b5cf6_0%,#6366f1_50%,#22d3ee_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_0_24px_4px_rgba(139,92,246,0.4),0_12px_32px_-8px_rgba(34,211,238,0.5)]',
        destructive:
          'text-white border border-white/20 bg-[linear-gradient(120deg,#f43f5e_0%,#ef4444_50%,#d946ef_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_0_24px_4px_rgba(244,63,94,0.4),0_12px_32px_-8px_rgba(217,70,239,0.5)]',
        outline:
          'border border-white/14 dark:border-white/14 bg-transparent backdrop-blur-sm hover:shadow-[0_0_16px_2px_rgba(139,92,246,0.2)] hover:bg-white/5',
        secondary:
          'border border-white/12 bg-[linear-gradient(120deg,#fff_0%,#f0f0ee_100%)] dark:bg-[linear-gradient(120deg,#1a1726_0%,#2a2438_100%)] text-aurora-ink dark:text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_0_12px_2px_rgba(139,92,246,0.15)]',
        ghost:
          'bg-transparent hover:bg-white/5 dark:hover:bg-white/5 hover:text-accent-foreground',
        link: 'text-aurora-cyan underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        default: 'h-10 px-4 py-2 rounded-[10px]',
        sm: 'h-9 px-3 rounded-[8px]',
        xs: 'h-7 px-2 text-xs rounded-[6px]',
        lg: 'h-11 px-8 rounded-[12px]',
        icon: 'h-9 w-9 rounded-[8px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = 'Button';

export { Button, buttonVariants };
