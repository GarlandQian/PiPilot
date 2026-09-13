export type ProvenanceRefreshOutcome = 'applied' | 'conflict' | 'stale'

/** Serialize entry-only reads, retaining a trailing event and at most one conflict retry. */
export function createProvenanceRefreshQueue({ ownerRevision, prepare }: {
  ownerRevision(): number
  prepare(): Promise<() => ProvenanceRefreshOutcome>
}) {
  let inFlight = false
  let dirty = false
  let disposed = false

  return {
    async request() {
      if (disposed) return
      dirty = true
      if (inFlight) return
      inFlight = true
      let conflictRetried = false
      try {
        while (dirty && !disposed) {
          dirty = false
          const owner = ownerRevision()
          try {
            const apply = await prepare()
            // Identity values may return to A after A→B→A; the owner revision cannot.
            if (disposed || owner !== ownerRevision()) continue
            if (apply() === 'conflict' && !conflictRetried) {
              conflictRetried = true
              dirty = true
            }
          } catch {
            // Optional provenance must not retry a failed read or affect availability.
            dirty = false
            return
          }
        }
      } finally {
        inFlight = false
      }
    },
    dispose() {
      disposed = true
      dirty = false
    },
  }
}
