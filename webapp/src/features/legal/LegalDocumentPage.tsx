import { Link } from '@tanstack/react-router'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ReactNode } from 'react'

import personalDataConsent from '../../../../docs/personal-data-consent.md?raw'
import privacyPolicy from '../../../../docs/privacy-policy.md?raw'
import termsOfUse from '../../../../docs/terms-of-use.md?raw'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import styles from './LegalDocumentPage.module.css'
import {
  applyLegalDocumentTemplate,
  publicLegalDocumentTemplateValuesFromBuildEnvironment,
} from './legal-document-template'

type LegalDocumentId = 'personal-data-consent' | 'privacy' | 'terms'

const legalDocuments: Record<LegalDocumentId, { bodyStart: string; markdown: string }> = {
  'personal-data-consent': {
    bodyStart: '**Версия согласия:**',
    markdown: personalDataConsent,
  },
  privacy: {
    bodyStart: '## 1. Общие положения',
    markdown: privacyPolicy,
  },
  terms: {
    bodyStart: '**Версия соглашения:**',
    markdown: termsOfUse,
  },
}

export function LegalDocumentPage({ documentId }: { documentId: LegalDocumentId }) {
  const { t } = useI18n()
  const document = legalDocuments[documentId]
  const lines = applyLegalDocumentTemplate(
    document.markdown,
    publicLegalDocumentTemplateValuesFromBuildEnvironment(),
  ).split(/\r?\n/)
  const title = cleanInline(lines[0]?.replace(/^#\s+/, '') ?? '')
  const bodyStart = lines.findIndex((line) => line.trim() === document.bodyStart)
  const publicationLines = bodyStart >= 0 ? lines.slice(bodyStart) : lines.slice(1)

  return (
    <section className={styles.page}>
      <article className={styles.document}>
        <header className={styles.header}>
          <Link className={styles.back} to="/" aria-label={t('legal.backToRegistration')}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.7} aria-hidden="true" />
          </Link>
          <Typography variant="h1">{title}</Typography>
        </header>
        <div className={styles.surface}>
          <MarkdownBlocks lines={publicationLines} />
        </div>
      </article>
    </section>
  )
}

function MarkdownBlocks({ lines }: { lines: string[] }) {
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }
    if (line === '---') {
      blocks.push(<hr key={`rule-${index}`} />)
      index += 1
      continue
    }

    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    if (heading) {
      const content = cleanInline(heading[2])
      blocks.push(
        heading[1].length === 2
          ? <Typography key={`heading-${index}`} variant="h2">{content}</Typography>
          : <Typography key={`heading-${index}`} variant="h3">{content}</Typography>,
      )
      index += 1
      continue
    }

    if (line.startsWith('- ')) {
      const items: string[] = []
      while (index < lines.length) {
        const itemStart = lines[index].trim()
        if (!itemStart.startsWith('- ')) break
        let item = itemStart.slice(2)
        index += 1
        while (
          index < lines.length
          && lines[index].trim()
          && !lines[index].trim().startsWith('- ')
          && !lines[index].trim().startsWith('#')
          && lines[index].trim() !== '---'
        ) {
          item += ` ${lines[index].trim()}`
          index += 1
        }
        items.push(cleanInline(item))
      }
      blocks.push(
        <ul key={`list-${index}`}>
          {items.map((item) => (
            <li key={item}><Typography as="span">{item}</Typography></li>
          ))}
        </ul>,
      )
      continue
    }

    let paragraph = line
    index += 1
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].trim().startsWith('#')
      && !lines[index].trim().startsWith('- ')
      && lines[index].trim() !== '---'
    ) {
      paragraph += ` ${lines[index].trim()}`
      index += 1
    }
    blocks.push(
      <Typography key={`paragraph-${index}`}>{cleanInline(paragraph)}</Typography>,
    )
  }

  return blocks
}

function cleanInline(value: string) {
  return value.replaceAll('**', '').replaceAll('`', '')
}
