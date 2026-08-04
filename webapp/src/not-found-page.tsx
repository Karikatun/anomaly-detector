import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <section className="grid min-h-svh place-items-center bg-[#03070d] p-6 text-center text-foreground">
      <div className="grid max-w-md justify-items-center gap-4">
        <Typography variant="h3">{t('notFound.title')}</Typography>
        <Button asChild variant="outline"><Link to="/">{t('notFound.home')}</Link></Button>
      </div>
    </section>
  )
}
