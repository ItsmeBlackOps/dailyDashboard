import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md bg-[linear-gradient(110deg,rgba(139,92,246,0.06)_0%,rgba(34,211,238,0.10)_50%,rgba(139,92,246,0.06)_100%)] bg-[length:200%_100%] animate-ep-shimmer", className)}
      {...props}
    />
  )
}

export { Skeleton }
