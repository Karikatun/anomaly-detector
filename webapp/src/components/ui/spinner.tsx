import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { translate } from "@/platform/i18n"

function Spinner({
  className,
  strokeWidth = 2,
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <HugeiconsIcon
      {...props}
      icon={Loading03Icon}
      strokeWidth={Number(strokeWidth)}
      role="status"
      aria-label={translate('app.loading')}
      className={cn("size-4 animate-spin", className)}
    />
  )
}

export { Spinner }
