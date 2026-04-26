import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium font-sans transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora-violet/40 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-[linear-gradient(120deg,#8b5cf6_0%,#22d3ee_100%)] data-[state=on]:text-white data-[state=on]:shadow-[0_4px_12px_-4px_rgba(139,92,246,0.5)]",
  {
    variants: {
      variant: {
        default: "bg-transparent border border-white/14",
        outline:
          "border border-white/14 bg-transparent hover:bg-white/5",
      },
      size: {
        default: "h-10 px-3",
        sm: "h-9 px-2.5",
        lg: "h-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle, toggleVariants }
