import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMemo, useState, type FormEvent } from 'react'

import {
  feedbackIntakeRequestSchema,
  type FeedbackCategory,
  type FeedbackReceipt,
} from '@anomaly-detector/contracts'

import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import expeditionStyles from '@/components/ExpeditionShell.module.css'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { ApiRequestError } from '@/platform/api/http-client'
import { useI18n } from '@/platform/i18n'

import { FeedbackApi } from './api'
import { consumeFeedbackOrigin } from './origin-route'
import { buildFeedbackTechnicalContext } from './technical-context'
import styles from './FeedbackPage.module.css'

export function FeedbackPage() {
  return (
    <ProtectedPage>
      <FeedbackContent />
    </ProtectedPage>
  )
}

function FeedbackContent() {
  const { t } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const api = useMemo(() => new FeedbackApi(auth.transport), [auth.transport])
  const [originPath] = useState(() => consumeFeedbackOrigin(sessionStorage) ?? '/feedback')
  const [category, setCategory] = useState<FeedbackCategory>('error')
  const [whatHappened, setWhatHappened] = useState('')
  const [reproductionSteps, setReproductionSteps] = useState('')
  const [expectedResult, setExpectedResult] = useState('')
  const [canContinue, setCanContinue] = useState(true)
  const [desiredChange, setDesiredChange] = useState('')
  const [problemSolved, setProblemSolved] = useState('')
  const [includeContact, setIncludeContact] = useState(false)
  const [replyEmail, setReplyEmail] = useState('')
  const [linkAccount, setLinkAccount] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<FeedbackReceipt | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const technicalContext = buildFeedbackTechnicalContext({
      buildSha: import.meta.env.VITE_BUILD_SHA,
      pathname: originPath,
      userAgent: navigator.userAgent,
      viewportWidth: window.innerWidth,
    })
    const candidate = category === 'error'
      ? {
          canContinue,
          category,
          expectedResult,
          linkAccount,
          replyEmail: includeContact ? replyEmail : null,
          reproductionSteps,
          technicalContext,
          whatHappened,
        }
      : {
          category,
          desiredChange,
          linkAccount,
          problemSolved,
          replyEmail: includeContact ? replyEmail : null,
          technicalContext,
        }
    const parsed = feedbackIntakeRequestSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(t('feedback.error.validation'))
      return
    }

    setIsSubmitting(true)
    try {
      const accepted = await api.submit(parsed.data)
      setReceipt(accepted)
      clearDraft()
    } catch (caught) {
      setError(feedbackErrorMessage(caught, t))
    } finally {
      setIsSubmitting(false)
    }
  }

  const clearDraft = () => {
    setWhatHappened('')
    setReproductionSteps('')
    setExpectedResult('')
    setDesiredChange('')
    setProblemSolved('')
    setReplyEmail('')
    setIncludeContact(false)
    setLinkAccount(false)
  }

  const copyPublicNumber = async () => {
    if (!receipt) return
    try {
      await navigator.clipboard.writeText(receipt.publicNumber)
      setCopyStatus(t('feedback.receipt.copied'))
    } catch {
      setCopyStatus(t('feedback.receipt.copyFailed'))
    }
  }

  return (
    <main className={expeditionStyles.screen}>
      <ExpeditionBackground />
      <section
        className={`${expeditionStyles.panel} ${styles.panel}`}
        aria-labelledby="feedback-page-title"
      >
        <header className={styles.header}>
          <div className={styles.headingCopy}>
            <Typography variant="h1" id="feedback-page-title" className={styles.title}>
              {receipt ? t('feedback.receipt.title') : t('feedback.title')}
            </Typography>
            <Typography className={styles.subtitle}>
              {receipt ? t('feedback.receipt.subtitle') : t('feedback.subtitle')}
            </Typography>
          </div>
          <Button
            type="button"
            variant="ghost"
            className={styles.backButton}
            onClick={() => void navigate({ to: '/' })}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.7} aria-hidden="true" />
            {t('feedback.back')}
          </Button>
        </header>

        {receipt ? (
          <section className={styles.receipt} aria-live="polite">
            <div className={styles.receiptMark} aria-hidden="true">
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={1.8} />
            </div>
            <Typography className={styles.receiptLabel}>{t('feedback.receipt.number')}</Typography>
            <Typography asChild>
              <code className={styles.publicNumber}>{receipt.publicNumber}</code>
            </Typography>
            <Typography className={styles.receiptNote}>{t('feedback.receipt.note')}</Typography>
            <div className={styles.receiptActions}>
              <Button type="button" onClick={() => void copyPublicNumber()}>
                {t('feedback.receipt.copy')}
              </Button>
              <Button type="button" variant="outline" onClick={() => void navigate({ to: '/' })}>
                {t('feedback.receipt.home')}
              </Button>
            </div>
            {copyStatus && <Typography role="status" className={styles.copyStatus}>{copyStatus}</Typography>}
          </section>
        ) : (
          <form className={styles.form} onSubmit={submit} noValidate>
            <section className={styles.reportSection} aria-labelledby="feedback-kind-title">
              <Typography as="h2" id="feedback-kind-title" className={styles.sectionTitle}>
                {t('feedback.kind.title')}
              </Typography>
              <div className={styles.categoryPicker} role="group" aria-label={t('feedback.kind.title')}>
                {(['error', 'suggestion'] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    className={styles.categoryButton}
                    aria-pressed={category === value}
                    onClick={() => {
                      setCategory(value)
                      setError(null)
                    }}
                  >
                    {t(value === 'error' ? 'feedback.kind.error' : 'feedback.kind.suggestion')}
                  </Button>
                ))}
              </div>
            </section>

            <section className={styles.reportSection} aria-labelledby="feedback-details-title">
              <Typography as="h2" id="feedback-details-title" className={styles.sectionTitle}>
                {t('feedback.details.title')}
              </Typography>
              {category === 'error' ? (
                <div className={styles.fields}>
                  <TextField
                    id="feedback-what-happened"
                    label={t('feedback.error.whatHappened')}
                    value={whatHappened}
                    onChange={setWhatHappened}
                  />
                  <TextField
                    id="feedback-reproduction-steps"
                    label={t('feedback.error.steps')}
                    value={reproductionSteps}
                    onChange={setReproductionSteps}
                  />
                  <TextField
                    id="feedback-expected-result"
                    label={t('feedback.error.expected')}
                    value={expectedResult}
                    onChange={setExpectedResult}
                  />
                  <CheckboxField
                    checked={canContinue}
                    id="feedback-can-continue"
                    label={t('feedback.error.canContinue')}
                    onChange={setCanContinue}
                  />
                </div>
              ) : (
                <div className={styles.fields}>
                  <TextField
                    id="feedback-desired-change"
                    label={t('feedback.suggestion.change')}
                    value={desiredChange}
                    onChange={setDesiredChange}
                  />
                  <TextField
                    id="feedback-problem-solved"
                    label={t('feedback.suggestion.problem')}
                    value={problemSolved}
                    onChange={setProblemSolved}
                  />
                </div>
              )}
            </section>

            <aside className={styles.warning} id="feedback-secret-warning">
              <Typography as="h2" className={styles.warningTitle}>{t('feedback.warning.title')}</Typography>
              <Typography className={styles.warningText}>{t('feedback.warning.body')}</Typography>
            </aside>

            <section className={styles.reportSection} aria-labelledby="feedback-reply-title">
              <Typography as="h2" id="feedback-reply-title" className={styles.sectionTitle}>
                {t('feedback.reply.title')}
              </Typography>
              <div className={styles.preferences}>
                <CheckboxField
                  checked={includeContact}
                  id="feedback-include-contact"
                  label={t('feedback.reply.allow')}
                  onChange={(checked) => {
                    setIncludeContact(checked)
                    if (!checked) setReplyEmail('')
                  }}
                />
                {includeContact && (
                  <div className={styles.emailField}>
                    <Label htmlFor="feedback-reply-email">{t('feedback.reply.email')}</Label>
                    <Input
                      id="feedback-reply-email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      required
                      value={replyEmail}
                      onChange={(event) => setReplyEmail(event.currentTarget.value)}
                    />
                    <Typography className={styles.fieldHint}>{t('feedback.reply.emailHint')}</Typography>
                  </div>
                )}
                <CheckboxField
                  checked={linkAccount}
                  id="feedback-link-account"
                  label={t('feedback.reply.linkAccount')}
                  onChange={setLinkAccount}
                />
              </div>
            </section>

            {error && <Typography role="alert" className={styles.error}>{error}</Typography>}
            <div className={styles.formActions}>
              <Button type="submit" disabled={isSubmitting} aria-describedby="feedback-secret-warning">
                {isSubmitting ? t('feedback.submit.pending') : t('feedback.submit')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void navigate({ to: '/' })}>
                {t('feedback.postpone')}
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}

function TextField({
  id,
  label,
  onChange,
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <div className={styles.textField}>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        className={styles.textarea}
        maxLength={2_000}
        required
        rows={4}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <Typography className={styles.characterCount}>{value.length}/2000</Typography>
    </div>
  )
}

function CheckboxField({
  checked,
  id,
  label,
  onChange,
}: {
  checked: boolean
  id: string
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <div className={styles.checkboxField}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

function feedbackErrorMessage(error: unknown, t: ReturnType<typeof useI18n>['t']) {
  if (error instanceof ApiRequestError && error.status === 429) {
    return t('feedback.error.rateLimited')
  }
  if (error instanceof ApiRequestError && error.code === 'VALIDATION_ERROR') {
    return t('feedback.error.validation')
  }
  return t('feedback.error.generic')
}
