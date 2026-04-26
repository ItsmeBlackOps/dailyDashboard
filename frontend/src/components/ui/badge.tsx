import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium font-mono tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-aurora-violet/60 focus:ring-offset-0",
  {
    variants: {
      variant: {
        default:
          "border-white/20 bg-[linear-gradient(120deg,#8b5cf6_0%,#6366f1_50%,#22d3ee_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] hover:shadow-[0_0_12px_2px_rgba(139,92,246,0.3)]",
        secondary:
          "bg-white/8 dark:bg-aurora-ink2 border-white/12 text-foreground",
        destructive:
          "border-white/20 bg-[linear-gradient(120deg,#f43f5e_0%,#ef4444_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]",
        outline:
          "border-aurora-violet/40 bg-transparent text-aurora-violet",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
