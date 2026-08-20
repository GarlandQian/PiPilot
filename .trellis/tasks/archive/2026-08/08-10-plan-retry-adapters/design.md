# Technical Design

## Adapter Registry

One small registry receives the exact Integrations package snapshot and the
current official Pi projection. It supports exactly two adapter IDs:

```ts
type RichAdapterId = 'plan-mode' | 'retry'

type AdapterContext = {
  scopeKey: string
  sessionId: string
  generation: number
  packages: readonly PiPackageSummary[]
  commands: readonly LocalPiSlashCommand[]
}
```

Each adapter has a version predicate, runtime capability schema, projector, and
generic fallback. The registry stores no package paths and never loads extension
code. Adapter state resets when the context identity changes.

The runtime snapshot is independent of the Integrations Settings tab's selected
scope. Projectless loads global packages. A project runtime loads global plus
that selected project's packages, deduplicates npm identities with project
precedence, and applies only results for the same scope and process generation.
An unsupported project version therefore shadows a supported global version.
Rich activation additionally requires `sourceType === 'npm'`.

## Plan Projection

Activation requires the exact supported `@narumitw/pi-plan-mode` package and an
official `/plan` command whose source metadata matches that package. A versioned
schema accepts only supported `plan_mode_complete` details and bounded Markdown.
Supported `proposed-plan` messages and exact status values may restore the
current lifecycle.

```ts
type PlanAdapterState =
  | { state: 'inactive' }
  | { state: 'planning' }
  | { state: 'ready'; markdown: string; sourceEntryId: string }
  | { state: 'saved'; markdown?: string }
  | { state: 'implementing'; markdown?: string }
  | { state: 'error'; message: string }
```

The plan block is attached to the producing turn when possible; an active
summary uses the generic activity host. Actions map only to supported direct
command routes through official `prompt`, or open the extension's existing
official RPC dialog route. Revision sends a normal user plan-mode message and
invalidates the previous ready action state until a new completion arrives.

No renderer action reads or mutates package-private session records.

## Retry Projection And Settings

The Integrations helper exposes strict read and `setEnabled` operations backed
by the exact local Pi `SettingsManager`. Its snapshot exposes both the explicit
global persisted `retry.enabled` value (or the public default when absent) and
the current cwd's merged effective retry settings. This distinction is
required because Pi 0.84.1 `setRetryEnabled()` always writes global settings,
while `getRetrySettings()` reads the merged current scope. `setEnabled`
performs:

1. load current matching settings;
2. call `setRetryEnabled(enabled)` and `flush()`;
3. drain/return settings errors, the resulting global persisted value, and the
   current scope's effective settings;
4. if persistence succeeded and the selected Agent process is ready, re-read
   the active project's effective setting when the management operation was
   global, then call official `set_auto_retry` for that exact cwd/generation;
5. return `synchronized`, `persisted-only`, or typed failure.

The projector already receives official retry events and is extended to retain
the full state:

```ts
type RetryActivity =
  | { kind: 'idle' }
  | { kind: 'provider'; phase: 'waiting' | 'retrying'; attempt: number;
      maxAttempts: number; deadline?: number; reason: string }
  | { kind: 'provider-result'; success: boolean; attempt: number;
      message?: string; settledAt: number }
  | { kind: 'summarization'; phase: string; message?: string }
```

The countdown derives `deadline - now` for display only. It cannot dispatch a
retry. Stop sends `abort_retry` only while the official phase is waiting and
remains cancelling until the authoritative end event/command settlement.

Exact `pi-retry@0.31.0` status key `retry` values `receiving` and `retrying` may
refine the phase label. No status value can synthesize attempt counters or
settlement. Unknown/unsupported status remains in the generic activity strip.

## Error And Stale-State Rules

- Adapter schema failure records a bounded compatibility diagnostic and keeps
  the generic source visible.
- A late plan/tool/status/retry event with old generation/session identity is
  ignored.
- Plan action replacement uses the existing command loading/hydration gate.
- Retry settings write failure does not call runtime synchronization.
- Runtime sync failure never rolls back a successful Pi settings write; it
  reports persisted-only and offers controlled retry/restart.
- A successful runtime replacement re-reads package and retry settings before
  adapter activation.

## Rollback

Both adapters are renderer/Main integration modules on top of generic official
behavior. Removing one registration restores generic presentation. Retry
settings writes use Pi's existing file and need no migration; a code rollback
does not revert the user's explicitly selected value.
