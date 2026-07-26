import {
  Analytics01Icon,
  ArrowDown01Icon,
  Award02Icon,
  ContractsIcon,
  InformationCircleIcon,
  SignalFullIcon,
  TestTube01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
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
import { Typography } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { type TranslationKey, useI18n } from '@/platform/i18n'
import styles from './RulesReferenceDialog.module.css'

const sections = [
  {
    id: 'concept',
    titleKey: 'rules.concept.title',
    summaryKey: 'rules.concept.summary',
  },
  {
    id: 'terms',
    titleKey: 'rules.terms.title',
    summaryKey: 'rules.terms.summary',
  },
  {
    id: 'general',
    titleKey: 'rules.general.title',
    summaryKey: 'rules.general.summary',
  },
  {
    id: 'phases',
    titleKey: 'rules.phases.title',
    summaryKey: 'rules.phases.summary',
  },
  {
    id: 'laboratory',
    titleKey: 'rules.laboratory.title',
    summaryKey: 'rules.laboratory.summary',
  },
] as const

type RuleSectionId = typeof sections[number]['id']

const conceptItems = [
  'rules.concept.1',
  'rules.concept.2',
  'rules.concept.3',
] as const

const terms = [
  { icon: SignalFullIcon, titleKey: 'rules.terms.signal.title', bodyKey: 'rules.terms.signal.body' },
  { icon: SignalFullIcon, titleKey: 'rules.terms.sample.title', bodyKey: 'rules.terms.sample.body' },
  { icon: TestTube01Icon, titleKey: 'rules.terms.test.title', bodyKey: 'rules.terms.test.body' },
  { icon: Analytics01Icon, titleKey: 'rules.terms.model.title', bodyKey: 'rules.terms.model.body' },
  { icon: Analytics01Icon, titleKey: 'rules.terms.thesis.title', bodyKey: 'rules.terms.thesis.body' },
  { icon: Award02Icon, titleKey: 'rules.terms.rating.title', bodyKey: 'rules.terms.rating.body' },
  { icon: ContractsIcon, titleKey: 'rules.terms.budget.title', bodyKey: 'rules.terms.budget.body' },
  { icon: ContractsIcon, titleKey: 'rules.terms.trust.title', bodyKey: 'rules.terms.trust.body' },
] as const

const generalItems = [
  'rules.general.1',
  'rules.general.2',
  'rules.general.3',
  'rules.general.4',
  'rules.general.5',
  'rules.general.6',
] as const

const phases = [
  ['rules.phases.contractReveal.title', 'rules.phases.contractReveal.body'],
  ['rules.phases.access.title', 'rules.phases.access.body'],
  ['rules.phases.power.title', 'rules.phases.power.body'],
  ['rules.phases.recon.title', 'rules.phases.recon.body'],
  ['rules.phases.lab.title', 'rules.phases.lab.body'],
  ['rules.phases.analysis.title', 'rules.phases.analysis.body'],
  ['rules.phases.contracts.title', 'rules.phases.contracts.body'],
  ['rules.phases.roundEnd.title', 'rules.phases.roundEnd.body'],
] as const

const laboratoryRows = [
  ['rules.laboratory.relation.same', 'rules.laboratory.polarity.same', 'rules.laboratory.result.gain'],
  ['rules.laboratory.relation.same', 'rules.laboratory.polarity.different', 'rules.laboratory.result.attenuation'],
  ['rules.laboratory.relation.next', 'rules.laboratory.polarity.same', 'rules.laboratory.result.reflection'],
  ['rules.laboratory.relation.next', 'rules.laboratory.polarity.different', 'rules.laboratory.result.collapse'],
  ['rules.laboratory.relation.previous', 'rules.laboratory.polarity.same', 'rules.laboratory.result.attenuation'],
  ['rules.laboratory.relation.previous', 'rules.laboratory.polarity.different', 'rules.laboratory.result.gain'],
] as const

export function RulesReferenceDialog({
  triggerVariant = 'outline',
  triggerClassName,
  triggerIconOnly = false,
  triggerLabelKey = 'rules.open',
  triggerTextClassName,
  belowTenderHeader = false,
}: {
  belowTenderHeader?: boolean
  triggerVariant?: 'default' | 'outline' | 'ghost'
  triggerClassName?: string
  triggerIconOnly?: boolean
  triggerLabelKey?: TranslationKey
  triggerTextClassName?: string
}) {
  const { t } = useI18n()
  const [openSections, setOpenSections] = useState<Set<RuleSectionId>>(
    () => new Set(['concept']),
  )

  const toggleSection = (section: RuleSectionId) => {
    setOpenSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerIconOnly ? 'icon-sm' : 'sm'}
          className={cn(triggerClassName)}
          title={triggerIconOnly ? t(triggerLabelKey) : undefined}
        >
          {triggerIconOnly && (
            <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={1.7} aria-hidden="true" />
          )}
          <Typography
            as="span"
            variant="control"
            className={cn(triggerIconOnly && 'sr-only', triggerTextClassName)}
          >
            {t(triggerLabelKey)}
          </Typography>
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className={cn(styles.content, belowTenderHeader && styles.belowTenderHeader)}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle>{t('rules.title')}</DialogTitle>
          <DialogDescription>{t('rules.description')}</DialogDescription>
        </DialogHeader>

        <div className={styles.scrollArea}>
          <div className={styles.accordion}>
            {sections.map((section) => {
              const isOpen = openSections.has(section.id)
              const triggerId = `rules-${section.id}-trigger`
              const panelId = `rules-${section.id}-panel`
              return (
                <section key={section.id} className={styles.section}>
                  <button
                    id={triggerId}
                    type="button"
                    className={styles.sectionTrigger}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggleSection(section.id)}
                  >
                    <span className={styles.sectionHeading}>
                      <Typography as="span" variant="h6">{t(section.titleKey)}</Typography>
                      <Typography as="span" variant="bodyXs" tone="muted">
                        {t(section.summaryKey)}
                      </Typography>
                    </span>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      strokeWidth={1.8}
                      className={cn(styles.chevron, isOpen && styles.chevronOpen)}
                      aria-hidden="true"
                    />
                  </button>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={triggerId}
                    className={styles.sectionPanel}
                    hidden={!isOpen}
                  >
                    <RuleSectionContent section={section.id} />
                  </div>
                </section>
              )
            })}
          </div>
        </div>

        <DialogFooter className={styles.footer}>
          <DialogClose asChild>
            <Button type="button" variant="outline" className={styles.closeButton}>
              {t('rules.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RuleSectionContent({ section }: { section: RuleSectionId }) {
  const { t } = useI18n()

  if (section === 'concept') {
    return <RuleList items={conceptItems} />
  }

  if (section === 'terms') {
    return (
      <div className={styles.termGrid}>
        {terms.map((term) => (
          <article key={term.titleKey} className={styles.term}>
            <span className={styles.termIcon}>
              <HugeiconsIcon icon={term.icon} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className={styles.termCopy}>
              <Typography as="span" variant="bodySmMedium">{t(term.titleKey)}</Typography>
              <Typography as="span" variant="bodyXs" tone="muted">{t(term.bodyKey)}</Typography>
            </span>
          </article>
        ))}
      </div>
    )
  }

  if (section === 'general') {
    return <RuleList items={generalItems} />
  }

  if (section === 'phases') {
    return (
      <ol className={styles.phaseList}>
        {phases.map(([titleKey, bodyKey], index) => (
          <li key={titleKey} className={styles.phase}>
            <Typography as="span" variant="controlXs" className={styles.phaseNumber}>
              {index + 1}
            </Typography>
            <span className={styles.phaseCopy}>
              <Typography as="span" variant="bodySmMedium">{t(titleKey)}</Typography>
              <Typography as="span" variant="bodyXs" tone="muted">{t(bodyKey)}</Typography>
            </span>
          </li>
        ))}
      </ol>
    )
  }

  return (
    <div className={styles.laboratory}>
      <Typography variant="bodySm">{t('rules.laboratory.direction')}</Typography>
      <div className={styles.protocolGrid}>
        <article className={styles.protocol}>
          <Typography variant="bodySmMedium">{t('rules.laboratory.impulse.title')}</Typography>
          <Typography variant="bodyXs" tone="muted">{t('rules.laboratory.impulse.body')}</Typography>
        </article>
        <article className={styles.protocol}>
          <Typography variant="bodySmMedium">{t('rules.laboratory.continuous.title')}</Typography>
          <Typography variant="bodyXs" tone="muted">{t('rules.laboratory.continuous.body')}</Typography>
        </article>
      </div>
      <Typography variant="bodySmMedium">{t('rules.laboratory.cycle')}</Typography>
      <div className={styles.tableScroll}>
        <table className={styles.resultTable}>
          <thead>
            <tr>
              <Typography asChild variant="bodyXs">
                <th scope="col">{t('rules.laboratory.table.relation')}</th>
              </Typography>
              <Typography asChild variant="bodyXs">
                <th scope="col">{t('rules.laboratory.table.polarity')}</th>
              </Typography>
              <Typography asChild variant="bodyXs">
                <th scope="col">{t('rules.laboratory.table.result')}</th>
              </Typography>
            </tr>
          </thead>
          <tbody>
            {laboratoryRows.map(([relationKey, polarityKey, resultKey]) => (
              <tr key={`${relationKey}-${polarityKey}`}>
                <Typography asChild variant="bodyXs">
                  <td>{t(relationKey)}</td>
                </Typography>
                <Typography asChild variant="bodyXs">
                  <td>{t(polarityKey)}</td>
                </Typography>
                <Typography asChild variant="bodySmMedium">
                  <td>{t(resultKey)}</td>
                </Typography>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className={styles.example}>
        <Typography variant="bodySmMedium">{t('rules.laboratory.example.title')}</Typography>
        <Typography variant="bodyXs">{t('rules.laboratory.example.body')}</Typography>
      </aside>
      <Typography variant="bodyXs" tone="muted">{t('rules.laboratory.privateNote')}</Typography>
    </div>
  )
}

function RuleList({ items }: { items: readonly TranslationKey[] }) {
  const { t } = useI18n()
  return (
    <ul className={styles.ruleList}>
      {items.map((item) => (
        <li key={item}><Typography variant="bodySm">{t(item)}</Typography></li>
      ))}
    </ul>
  )
}
