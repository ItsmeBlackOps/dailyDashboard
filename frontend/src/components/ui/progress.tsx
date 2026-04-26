import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-white/10",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="relative h-full w-full flex-1 bg-[linear-gradient(90deg,#8b5cf6,#22d3ee)] transition-all after:absolute after:inset-0 after:animate-ep-shimmer after:bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.2)_50%,transparent_70%)] after:bg-[length:200%_100%]"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
