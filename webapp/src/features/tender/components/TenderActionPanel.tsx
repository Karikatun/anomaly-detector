import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'

export function TenderActionPanel({
  children,
  description,
  error,
  footer,
  title,
}: {
  children: ReactNode
  description: ReactNode
  error?: string | null
  footer: ReactNode
  title: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {children}
        {error && (
          <Typography role="alert" variant="bodySm" tone="destructive" className="mt-4">
            {error}
          </Typography>
        )}
        {footer}
      </CardContent>
    </Card>
  )
}

export function UnavailablePhaseCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-8">
        <Typography tone="muted">{children}</Typography>
      </CardContent>
    </Card>
  )
}
