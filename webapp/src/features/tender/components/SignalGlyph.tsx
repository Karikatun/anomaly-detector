import { useId } from 'react'

import type { SignalId } from '@anomaly-detector/contracts'

import { signalAccent } from './signal-visuals'

export function SignalGlyph({
  className,
  signal,
}: {
  className?: string
  signal?: SignalId
}) {
  const gradientId = useId()
  const accent = signal ? signalAccent(signal) : '#8294a8'

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      style={{ color: accent }}
    >
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0" stopColor="currentColor" stopOpacity=".72" />
          <stop offset=".48" stopColor="currentColor" stopOpacity=".16" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill={`url(#${gradientId})`} />
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeOpacity=".35" />
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeOpacity=".18" strokeDasharray="2 4" />

      {!signal && (
        <>
          <path d="M20 25 32 18l12 7v14l-12 7-12-7V25Z" stroke="currentColor" strokeWidth="2" />
          <path d="M28.5 28.2a4.3 4.3 0 0 1 7.7 2.6c0 3-4.2 3.2-4.2 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="32" cy="41.5" r="1.4" fill="currentColor" />
        </>
      )}

      {signal === 'aster' && (
        <>
          <circle cx="32" cy="32" r="4.5" fill="white" />
          <path d="M32 9v46M9 32h46M16 16l32 32M48 16 16 48" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="m32 17 3.2 11.8L47 32l-11.8 3.2L32 47l-3.2-11.8L17 32l11.8-3.2L32 17Z" fill="currentColor" fillOpacity=".42" />
        </>
      )}

      {signal === 'boreal' && (
        <>
          <circle cx="32" cy="32" r="4" fill="currentColor" />
          <path d="M23 22a14 14 0 0 0 0 20M17 17a21 21 0 0 0 0 30M41 22a14 14 0 0 1 0 20M47 17a21 21 0 0 1 0 30" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </>
      )}

      {signal === 'cinder' && (
        <>
          <circle cx="32" cy="32" r="15" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="32" cy="32" r="9" stroke="currentColor" strokeWidth="2" />
          <circle cx="32" cy="32" r="3.5" fill="currentColor" />
          <path d="M32 11v5M32 48v5M11 32h5M48 32h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}

      {signal === 'delta' && (
        <>
          <path d="m32 14 18 33H14l18-33Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="m32 23 9 17H23l9-17Z" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="32" cy="32" r="2.4" fill="currentColor" />
        </>
      )}

      {signal === 'eclipse' && (
        <>
          <path d="M12 35c10-18 28-22 40-9-13-3-22 3-25 12 8-7 17-7 25-2-10 18-29 20-40 7 10 2 18-2 23-10-8 6-16 6-23 2Z" fill="currentColor" fillOpacity=".58" />
          <circle cx="32" cy="32" r="5" fill="#061321" stroke="currentColor" strokeWidth="2" />
        </>
      )}

      {signal === 'ferro' && (
        <>
          <path d="M14 37c4-15 17-23 31-17M18 44c7-12 20-17 32-10M22 49c7-8 17-11 27-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M15 37h9l-4-7M18 44h9l-4-7M22 49h9l-4-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}
