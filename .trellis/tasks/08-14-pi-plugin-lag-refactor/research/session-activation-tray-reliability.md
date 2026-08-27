# Session Activation and Tray Reliability

## Bug Analysis: intermittent Session selection, background task loss, and close-time task loss

### 1. Root Cause Category

- **Category**: B/D/E — cross-layer contract, test gap, implicit assumption.
- **Specific cause**: while `PiRuntimeFrontend.activate()` disposed a failed
  candidate Runtime, the synchronous pool snapshot reported that candidate as
  absent. The Host snapshot subscriber treated any missing active Runtime as a
  Host crash, called whole-Host cache eviction, and removed the previously
  healthy Runtime before activation error recovery could restore it. The code
  implicitly assumed an active Runtime can disappear only after a crash, which
  is false during controlled replacement cleanup.
- **Desktop cause**: BrowserWindow close and application quit shared the same
  lifecycle. On non-macOS, `window-all-closed` called `app.quit()`, so closing
  the UI disposed utility Hosts and stopped active work instead of keeping it
  available in the tray.
- **Background Session cause**: foreground selection, command ownership, and
  Runtime lifetime were represented by one mutable `active` pointer and one
  global lifecycle queue. Navigation therefore either stopped the previous
  Runtime or made a late command completion capable of publishing into the new
  selection. Session rename also reused activation/session-changing paths,
  unnecessarily requiring the row to become the foreground Runtime.
- **Streaming presentation cause**: the renderer used percentage-sized reveal
  steps and deferred Markdown input. A large SDK delta could therefore appear
  almost atomically even though the transcript reported a live turn.

### 2. Why earlier fixes were incomplete

1. Renderer loading/hydration guards prevented stale UI, but could not recover
   a Main Runtime cache that had already been evicted.
2. Catalog refresh/token fixes removed several first-click races, but this
   failure occurs after catalog resolution inside the Host/Runtime boundary.
3. Happy-path A/B selection tests did not inject a transient hydration failure,
   so the nested synchronous pool-snapshot callback was not exercised.
4. Earlier concurrency coverage proved multiple Runtime allocation but not the
   user sequence that matters: start a delayed prompt in Session A, select a
   new Session B, reselect A while it is still running, then stop only A.
5. Rename tests exercised the SDK command on the foreground Runtime, not an
   opaque catalog row whose Runtime was inactive or not allocated.

### 3. Prevention mechanisms

| Priority | Mechanism | Specific action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Explicit activation-depth boundary; suppress false crash synthesis only while replacement owns the transient state | DONE |
| P0 | Recovery | Dispose only failed candidate, restore previous healthy Runtime, bounded one-time retry | DONE |
| P0 | Test | Unit-inject hydration failure; Electron A → B → cached A and repeated cold first-click | DONE |
| P0 | Lifecycle | Close hides to persistent Tray; explicit Quit/update alone invokes shutdown coordinator | DONE |
| P0 | Ownership | Capture exact `{runtimeId,generation}` for every command; selection changes only renderer projection, not the captured command or Runtime lifetime | DONE |
| P0 | Concurrency | Serialize commands per Runtime, but do not put unrelated Runtime commands behind the global selection lifecycle | DONE |
| P0 | Navigation | Creating/selecting another Session never implicitly aborts or disposes a running Runtime | DONE |
| P0 | Rename | Resolve the opaque catalog token in Main and rename the exact Session file/owning Runtime without foreground activation | DONE |
| P0 | Streaming | Bound live reveal to small character steps on animation frames; do not defer the deliberately staged Markdown value | DONE |
| P1 | Documentation | Embedded Host, state-management, desktop quality, PRD/design/implementation contracts updated | DONE |

### 4. Systematic expansion

- Any synchronous observer fired from a cleanup method can see a valid
  transient state. Lifecycle owners must encode transactions rather than infer
  crash from one intermediate snapshot.
- Renderer operation identity and Main Runtime identity solve different
  problems: the renderer must not accept a restored old snapshot as the new
  selection, while Main should retain that old Runtime as safe fallback.
- Window visibility is presentation state. Host/Runtime/Terminal disposal is
  application-terminal state and must not be coupled to normal window close.
- Foreground selection is also presentation state. It determines which Runtime
  publishes transcript/UI events to Renderer, but it does not transfer
  ownership of an already accepted command and does not imply cancellation.
- Numeric Runtime generation is meaningful only inside one `runtimeId`.
  Cross-Runtime activation and command completion must use the complete
  identity, plus renderer selection-operation identity where applicable.
- Metadata mutations such as rename belong to the catalog capability selected
  by an opaque token. They must not activate the target Session just to reach
  its `SessionManager`.

### 5. Verification evidence

- Focused Runtime unit suite injects one transient hydration failure (automatic
  retry succeeds) and two failures (previous Runtime remains ready; requested
  activation returns a terminal error).
- Real Electron first-click workflow covers delayed Host startup, a 9 MiB
  Session entry, A → B → retained A re-selection, loading completion and exact
  Runtime/session identity.
- Real Electron tray workflow starts a delayed SDK prompt, hides the window,
  waits for completion, restores the same window and observes the response.
- Real SDK Electron workflow starts a 30-second prompt in a persisted project
  Session, creates another project Session, reselects the original with one
  click while it is still running, observes its transcript and Stop action,
  aborts only that Runtime, and renames the Session through its catalog row.
- The same workflow asserts that a long one-delta provider response enters the
  live typing state before its full text is visible, then settles normally.

No specification template mirror exists at `src/templates/markdown/spec/` in
this repository, so there is no generated template copy to synchronize.
