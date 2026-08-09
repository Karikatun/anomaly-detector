import * as React from "react"

import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { Typography } from "@/components/ui/typography"

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({
  className,
  size = "default",
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-full min-w-0",
        className
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <Typography asChild variant="control">
        <select
          data-slot="native-select"
          data-size={size}
          className="h-12 w-full min-w-0 appearance-none rounded-[var(--radius-control)] border border-[var(--border-game-strong)] bg-[var(--surface-control)] py-2 pr-11 pl-4 text-foreground shadow-[var(--shadow-inset-subtle)] transition-[color,background-color,border-color,box-shadow,opacity] duration-[var(--motion-normal)] ease-[var(--ease-standard)] outline-none select-none selection:bg-primary selection:text-primary-foreground hover:border-primary/60 hover:bg-input/40 focus-visible:border-primary focus-visible:shadow-[var(--focus-ring-shadow)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--opacity-disabled)] aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 data-[size=sm]:h-11 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
          {...props}
        />
      </Typography>
      <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={1.8} className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-primary/80 select-none" aria-hidden="true" data-slot="native-select-icon" />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
