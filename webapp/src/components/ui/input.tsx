import * as React from "react"

import { cn } from "@/lib/utils"
import { Typography } from "@/components/ui/typography"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <Typography asChild variant="input">
      <input
        type={type}
        data-slot="input"
        className={cn(
          "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-input bg-input/30 px-3 py-1 transition-[color,background-color,border-color,box-shadow,opacity] duration-[var(--motion-standard)] ease-[var(--ease-standard)] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[var(--focus-ring-shadow)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--opacity-disabled)] aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
    </Typography>
  )
}

export { Input }
