import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Typography } from '@/components/ui/typography'
import { type TranslationKey, useI18n } from '@/platform/i18n'

const sections = [
  ['overview', ['overview.1', 'overview.2']],
  ['round', ['round.1', 'round.2', 'round.3', 'round.4', 'round.5', 'round.6']],
  ['research', ['research.1', 'research.2', 'research.3']],
  ['analysis', ['analysis.1', 'analysis.2']],
  ['contracts', ['contracts.1', 'contracts.2', 'contracts.3', 'contracts.4']],
  ['final', ['final.1', 'final.2']],
] as const

export function RulesReferenceDialog({
  triggerVariant = 'outline',
  triggerClassName,
  triggerLabelKey = 'rules.open',
  triggerTextClassName,
}: {
  triggerVariant?: 'default' | 'outline' | 'ghost'
  triggerClassName?: string
  triggerLabelKey?: TranslationKey
  triggerTextClassName?: string
}) {
  const { t } = useI18n()

  return (
      <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size="sm" className={cn(triggerClassName)}>
          <Typography as="span" variant="control" className={cn(triggerTextClassName)}>{t(triggerLabelKey)}</Typography>
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] max-w-3xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('rules.title')}</DialogTitle>
          <DialogDescription>{t('rules.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 pr-1">
          {sections.map(([section, items], index) => (
            <section key={section} className="grid gap-2" aria-labelledby={`rules-${section}`}>
              {index > 0 && <Separator className="mb-3" />}
              <Typography id={`rules-${section}`} variant="h5">{t(`rules.${section}.title`)}</Typography>
              <ul className="grid list-disc gap-2 pl-5">
                {items.map((item) => <li key={item}><Typography variant="bodySm">{t(`rules.${item}`)}</Typography></li>)}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{t('rules.close')}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
