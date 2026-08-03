import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/ui/typography'

export function NotFoundPage() {
  return (
    <section className="grid min-h-svh place-items-center bg-[#03070d] p-6 text-center text-foreground">
      <div className="grid max-w-md justify-items-center gap-4">
        <Typography variant="h3">Страница не найдена</Typography>
        <Button asChild variant="outline"><Link to="/">На главную</Link></Button>
      </div>
    </section>
  )
}
