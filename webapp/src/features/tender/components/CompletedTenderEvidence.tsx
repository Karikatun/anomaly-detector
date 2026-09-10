import type { CSSProperties } from 'react'
import type { TenderView } from '@anomaly-detector/contracts'

import { Typography } from '@/components/ui/typography'
import { translate, useI18n } from '@/platform/i18n'
import { fieldTypeLabelKeys, polarityLabelKeys, signalIds, signalLabelKeys } from '../catalog'
import { SignalGlyph } from './SignalGlyph'
import { signalAccent } from './signal-visuals'
import styles from './CompletedTenderPanel.module.css'

type CompletedView = TenderView & { audit: NonNullable<TenderView['audit']> }

export function CompletedTenderModels({ view, players, showPlayerNames = true }: {
  view: CompletedView
  players: TenderView['players']
  showPlayerNames?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className={styles.auditPlayerList}>
      {players.map((player) => {
        const result = view.audit.finalScientificModelsByPlayer[player.playerId]
        return (
          <article key={player.playerId} className={styles.auditPlayer}>
            {showPlayerNames && (
              <Typography as="h4" variant="bodySmMedium">
                {player.bot
                  ? translate(`tender.player.bot.${player.bot.difficulty}`)
                  : player.displayName ?? player.playerId.slice(0, 8)}
              </Typography>
            )}
            {!result?.submitted ? (
              <Typography variant="caption" tone="muted">{translate('tender.completedTenderPanel.copy.023')}</Typography>
            ) : (
              <ul className={styles.auditEntries}>
                {signalIds.map((signal) => {
                  const claim = result.signals[signal]
                  if (!claim) return null
                  const correctProperties = Number(Boolean(claim.fieldTypeCorrect))
                    + Number(Boolean(claim.polarityCorrect))
                  return (
                    <li
                      key={signal}
                      className={styles.signalAuditEntry}
                      data-signal-score={correctProperties}
                      style={{ '--signal-accent': signalAccent(signal) } as CSSProperties}
                    >
                      <SignalGlyph signal={signal} className={styles.auditSignalGlyph} />
                      <span className={styles.auditEntryCopy}>
                        <span className={styles.signalAuditHeading}>
                          <Typography as="strong" variant="bodySmMedium">
                            {t(signalLabelKeys[signal])} · {correctProperties}/2
                          </Typography>
                        </span>
                        <span className={styles.correctness}>
                          {claim.fieldType && (
                            <Typography as="span" variant="caption" data-correct={String(Boolean(claim.fieldTypeCorrect))}>
                              {claim.fieldTypeCorrect ? '✓' : '×'} {t(fieldTypeLabelKeys[claim.fieldType])} · {claim.fieldTypeCorrect ? translate('tender.completedTenderPanel.correct') : translate('tender.completedTenderPanel.incorrect')}
                            </Typography>
                          )}
                          {claim.polarity && (
                            <Typography as="span" variant="caption" data-correct={String(Boolean(claim.polarityCorrect))}>
                              {claim.polarityCorrect ? '✓' : '×'} {t(polarityLabelKeys[claim.polarity])} · {claim.polarityCorrect ? translate('tender.completedTenderPanel.correct') : translate('tender.completedTenderPanel.incorrect')}
                            </Typography>
                          )}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        )
      })}
    </div>
  )
}

export function CompletedTenderConfiguration({ view }: { view: CompletedView }) {
  const { t } = useI18n()
  return (
    <div className={styles.signalGrid}>
      {signalIds.map((signal) => {
        const properties = view.audit.anomalyConfiguration.signals[signal]
        return (
          <article
            key={signal}
            className={styles.signalCard}
            style={{ '--signal-accent': signalAccent(signal) } as CSSProperties}
          >
            <SignalGlyph signal={signal} className={styles.signalGlyph} />
            <span className={styles.signalCopy}>
              <Typography as="strong" variant="bodySmMedium">{t(signalLabelKeys[signal])}</Typography>
              <span className={styles.signalProperties}>
                <Typography as="span" variant="caption">{t(fieldTypeLabelKeys[properties.fieldType])}</Typography>
                <Typography as="span" variant="caption">{t(polarityLabelKeys[properties.polarity])}</Typography>
              </span>
            </span>
          </article>
        )
      })}
    </div>
  )
}
