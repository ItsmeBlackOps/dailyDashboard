import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/10">
      <SliderPrimitive.Range className="absolute h-full bg-[linear-gradient(90deg,#8b5cf6,#22d3ee)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className={cn("block h-4 w-4 rounded-full border-2 border-aurora-violet bg-white shadow-[0_4px_12px_-4px_rgba(139,92,246,0.6)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora-violet/40 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50")} />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
