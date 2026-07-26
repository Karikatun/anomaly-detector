import type { CSSProperties, ReactNode } from 'react'

import { InformationCircleIcon, UserGroupIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import styles from './TenderActionPanel.module.css'

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

export function PhaseNotice({
  children,
  description,
  kind = 'unavailable',
}: {
  children: ReactNode
  description?: ReactNode
  kind?: 'unavailable' | 'waiting'
}) {
  return (
    <div
      className={styles.notice}
      role="status"
      style={{ '--notice-accent': kind === 'waiting' ? '#f4a51c' : '#28bff2' } as CSSProperties}
    >
      <HugeiconsIcon
        icon={kind === 'waiting' ? UserGroupIcon : InformationCircleIcon}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span className={styles.noticeCopy}>
        <Typography as="strong" variant="bodySmMedium">{children}</Typography>
        {description && <Typography variant="caption" tone="muted">{description}</Typography>}
      </span>
    </div>
  )
}
