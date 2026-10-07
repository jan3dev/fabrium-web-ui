import { cn } from "@/lib/utils"

const SIZE = { small: "size-4", medium: "size-6" } as const

// Indeterminate progress. `motion-reduce:animate-none`: a spinning element is a
// vestibular trigger.
function Spinner({
  className,
  size = "small",
  ...props
}: React.ComponentProps<"svg"> & { size?: keyof typeof SIZE }) {
  return (
    <svg
      role="status"
      aria-label="Loading"
      viewBox="0 0 24 24"
      fill="none"
      focusable="false"
      className={cn(SIZE[size], "animate-spin motion-reduce:animate-none", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export { Spinner }
