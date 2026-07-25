import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const typographyVariants = cva("min-w-0 tracking-normal", {
  variants: {
    variant: {
      h1: "font-heading text-4xl leading-tight font-semibold",
      h2: "font-heading text-3xl leading-tight font-semibold",
      h3: "font-heading text-2xl leading-snug font-semibold",
      h4: "font-heading text-xl leading-snug font-semibold",
      h5: "font-heading text-lg leading-snug font-medium",
      h6: "font-heading text-base leading-snug font-medium",
      lead: "text-lg leading-7 font-normal",
      body: "text-base leading-7 font-normal",
      bodySm: "text-sm leading-normal font-normal",
      bodySmSnug: "text-sm leading-snug font-normal",
      bodyXs: "text-xs leading-normal font-normal",
      bodySmMedium: "text-sm leading-normal font-medium",
      emphasis: "font-medium",
      label: "text-sm leading-none font-medium",
      control: "text-sm leading-none font-medium whitespace-nowrap",
      controlWrap: "text-sm leading-snug font-medium whitespace-normal",
      controlXs: "text-xs leading-none font-medium whitespace-nowrap",
      input:
        "text-base leading-normal font-normal md:text-sm file:text-sm file:font-medium",
      caption: "text-xs leading-normal font-normal",
      shortcut: "text-xs leading-normal tracking-widest font-normal",
      code: "font-mono text-sm leading-normal font-medium",
      timer: "font-mono text-xl leading-snug font-semibold tabular-nums",
      srOnly: "sr-only",
    },
    tone: {
      current: "",
      default: "text-foreground",
      muted: "text-muted-foreground",
      destructive: "text-destructive",
      primary: "text-primary",
      card: "text-card-foreground",
      popover: "text-popover-foreground",
      sidebar: "text-sidebar-foreground",
      inverse: "text-background",
    },
    align: {
      start: "text-left",
      center: "text-center",
      end: "text-right",
    },
    balance: {
      true: "text-balance",
    },
    pretty: {
      true: "text-pretty",
    },
    truncate: {
      true: "truncate",
    },
    wrap: {
      normal: "",
      nowrap: "whitespace-nowrap",
      break: "break-all",
    },
  },
  defaultVariants: {
    variant: "body",
    tone: "current",
  },
})

type TypographyVariant = NonNullable<
  VariantProps<typeof typographyVariants>["variant"]
>

const defaultElementByVariant: Record<TypographyVariant, React.ElementType> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  lead: "p",
  body: "p",
  bodySm: "p",
  bodySmSnug: "p",
  bodyXs: "p",
  bodySmMedium: "p",
  emphasis: "strong",
  label: "span",
  control: "span",
  controlWrap: "span",
  controlXs: "span",
  input: "span",
  caption: "span",
  shortcut: "span",
  code: "code",
  timer: "span",
  srOnly: "span",
}

type TypographyOwnProps<TElement extends React.ElementType = "span"> =
  VariantProps<typeof typographyVariants> & {
    as?: TElement
    asChild?: boolean
  }

type TypographyProps<TElement extends React.ElementType = "span"> =
  TypographyOwnProps<TElement> &
    Omit<
      React.ComponentPropsWithoutRef<TElement>,
      keyof TypographyOwnProps<TElement>
    >

function Typography<TElement extends React.ElementType = "span">({
  as,
  asChild = false,
  className,
  variant,
  tone,
  align,
  balance,
  pretty,
  truncate,
  wrap,
  ...props
}: TypographyProps<TElement>) {
  const resolvedVariant = variant ?? "body"
  const Comp = asChild ? Slot.Root : (as ?? defaultElementByVariant[resolvedVariant])
  const slotProps = asChild ? {} : { "data-slot": "typography" }

  return (
    <Comp
      {...slotProps}
      data-variant={resolvedVariant}
      className={cn(
        typographyVariants({
          variant: resolvedVariant,
          tone,
          align,
          balance,
          pretty,
          truncate,
          wrap,
        }),
        className
      )}
      {...props}
    />
  )
}

export { Typography }
export type { TypographyProps }
