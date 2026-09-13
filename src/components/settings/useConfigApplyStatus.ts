import * as React from 'react'
import type { ConfigApplyStatus } from '@/shared/config-apply'

interface ApplySnapshot {
  fingerprint: string
  applyStatus?: ConfigApplyStatus
}

export function reconcileConfigApplyObservation(
  expectedFingerprint: string,
  previous: ConfigApplyStatus,
  next: ApplySnapshot,
): ConfigApplyStatus {
  if (next.fingerprint !== expectedFingerprint) {
    return { ...previous, state: 'superseded' }
  }
  return next.applyStatus?.fingerprint === expectedFingerprint ? next.applyStatus : previous
}

/** Observes pending application without replacing a document's editable draft. */
export function useConfigApplyStatus(
  ownerKey: string,
  snapshot: ApplySnapshot | null,
  readSnapshot: (() => Promise<ApplySnapshot>) | null,
) {
  const [observed, setObserved] = React.useState<{
    ownerKey: string
    fingerprint: string
    source: ConfigApplyStatus
    status: ConfigApplyStatus
    readFailed: boolean
  } | null>(null)
  const source = snapshot?.applyStatus
  const fingerprint = snapshot?.fingerprint
  const current = observed?.ownerKey === ownerKey && observed.fingerprint === fingerprint &&
    observed.source === source ? observed : null
  const status = current?.status ?? (source?.fingerprint === fingerprint ? source : undefined)

  React.useEffect(() => {
    if (!readSnapshot || !fingerprint || !source || source.state !== 'pending') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let latest = source
    const refresh = async () => {
      try {
        const next = await readSnapshot()
        if (cancelled) return
        latest = reconcileConfigApplyObservation(fingerprint, latest, next)
        setObserved({ ownerKey, fingerprint, source, status: latest, readFailed: false })
      } catch {
        if (cancelled) return
        setObserved({ ownerKey, fingerprint, source, status: latest, readFailed: true })
      }
      if (!cancelled && latest.state === 'pending') timer = setTimeout(() => void refresh(), 2_000)
    }
    timer = setTimeout(() => void refresh(), 2_000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [fingerprint, ownerKey, readSnapshot, source])

  return { status, readFailed: current?.readFailed ?? false }
}
