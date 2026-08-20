# Official Pi Renderer Contract

## 1. Scope / Trigger

Use this contract whenever renderer code loads official Pi state, applies RPC
events, sends commands, displays model/session statistics, or builds Composer
payloads. Electron Main owns the process and filesystem; the renderer owns only
generation-safe presentation state and typed user actions.

## 2. Signatures

```ts
createLocalPiProjectorState(seed): LocalPiProjectorState
replaceLocalPiProjectorSnapshot(state, snapshot): LocalPiProjectorState
applyLocalPiProjectorEvent(state, envelope): LocalPiProjectorState
resetLocalPiProjectorState(state, scope): LocalPiProjectorState
derivePiConversationPresentation(input):
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; sessionId: string }
  | { status: 'error'; error: string }
piGenerationHydrationOutcome(
  target: { scopeKey: string; generation: number; sessionId: string } | null,
  activeScopeKey,
  activeSessionId,
  runtime,
  session,
  hydration,
  runtimeLoading,
  transcriptLoading,
): 'pending' | 'ready' | 'error'
orderConversationOutlineItemsForDisplay(items): ConversationOutlineItem[]

type PiResponseActivityScope = {
  scopeKey: string
  generation: number
  sessionId: string
}
type PiExtensionNotification = {
  id: string
  message: string
  type: 'info' | 'warning' | 'error'
  autoReveal?: boolean
}
createPiPendingPromptProvenance(scopeWithOperationAndMessageCount): PiPendingPromptProvenance
capturePiPendingPromptActivity(pending, scope, activity): PiPendingPromptProvenance | null
acceptPiPendingPrompt(pending, operationId): PiPendingPromptProvenance | null
projectPiPendingPromptActivities(pending, scopeWithAnchor, firstOrder):
  readonly LocalPiResponseActivityRecord[] | null
piPendingPromptSnapshotAnchor(pending, scope, projector): string | null
projectLocalPiTurns(projector, { scopeKey, responseActivities }): Turn[]
shouldStartTypewriterFromEmpty(motionEnabled, animateOnMount, streaming): boolean
presentToolCall(input: ToolPresentationInput): ToolCall
mergeSubagentPresentation(
  previous: SubagentPresentation | undefined,
  next: SubagentPresentation | undefined,
): SubagentPresentation | undefined
toolCallCopyText(call: ToolCall): string
projectToolActivitySequence(turns: readonly Turn[]):
  readonly ToolActivitySequenceItem[]
projectShellEvidence(source: string): {
  source: string
  defaultView: 'formatted' | 'raw'
  formattedMarkdown?: string
  truncated: boolean
}

type SubagentInspectorSelection = {
  sessionKey: string
  toolCallId: string
  sequence: number
}

usePiRpcActions().send(text, 'prompt' | 'follow_up' | 'steer', images?): Promise<void>
usePiRpcActions().fork(entryId): Promise<void>
usePiRpcActions().selectModel(providerId, modelId): Promise<void>
usePiRpcActions().compact(instructions?): Promise<void>
window.pipilot.localPi.runtime.restart(): Promise<LocalPiRuntimeSnapshot>
window.pipilot.localPi.runtime.rendererReady(): Promise<void>

projectComposerCommands(commands: readonly LocalPiSlashCommand[]):
  { topLevel: readonly ComposerSlashCandidate[]; skills: readonly ComposerExecutableCandidate[] }
dedupeRuntimeAdapterPackages(packages: readonly PiPackageSummary[]): PiPackageSummary[]
detectRichAdapterCapabilities({ packages, commands }): {
  planMode: PlanModeCapability | null
}
projectPlanMode(projector, capability, surfaces): PlanModeProjection | null
projectRetryActivity(projector): RetryActivityProjection
projectComposerMentionCandidates(
  paths: readonly WorkspacePathSearchEntry[],
  skills: readonly ComposerExecutableCandidate[],
): ComposerMentionCandidateGroups
filterComposerMentionCandidates(groups, query): ComposerMentionCandidateGroups
type ComposerCommandCatalogState =
  | { state: 'unavailable' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready' }

serializeComposerDocument(snapshot: ComposerDocumentSnapshot | JSONContent): string | null
shouldClearCapturedComposer(capturedScope, currentScope, capturedRevision, currentRevision): boolean
attachmentToPiImage(attachment): Promise<LocalPiImageContent>
```

## 3. Contracts

- Models, thinking levels, commands, messages, statistics, and extension
  surfaces come from the active official Pi process. Do not provide hard-coded
  or mock fallbacks in production UI.
- Composer slash candidates come only from the active generation's official
  `get_commands` snapshot. Typing `/` opens one compact Commands + Skills list;
  there is no local `/skills` navigation row or second-level search. Selecting
  a valid `skill:<name>` row where `source === 'skill'` inserts the same trusted
  Skill atom as the typed `@` picker. Selecting a non-Skill command inserts the
  exact `/<official-name> ` plain-text invocation. Neither route submits.
  PiPilot must not scan skill directories, read `SKILL.md`, infer precedence,
  expand instructions, or maintain a second skill registry.
- The Composer document schema is limited to doc, paragraph, text, hard break,
  and renderer-created atomic mention nodes. Path candidates come only from
  Main workspace search and use the canonical relative path as identity across
  file/directory metadata. Skill candidates come only from the official command
  projection. A document may contain many unique paths and at most one Skill;
  selecting an existing identity replaces it rather than creating a duplicate.
- Serialize the captured structured document once for Prompt, Follow-up, and
  Steer. File/directory atoms become deterministic escaped relative Markdown
  links in place. Remove the one Skill atom and only its inserted separator,
  then prefix the body with the exact `/skill:<name>` at byte zero. Reject
  malformed, unknown, or duplicate trusted structures instead of dropping data.
  Never append the removed `Referenced workspace paths` block.
- HTML paste is reduced to supported plain text and cannot recreate trusted
  atoms. Copy/cut exposes safe plain/Markdown text; a collapsed copy/cut must
  leave the clipboard and document unchanged. IME composition and key code 229
  do not open/select mentions or submit.
- Every runtime event is tagged with a process generation. Ignore stale
  generations; reset messages, queue, tools, retry, compaction, dialogs,
  notifications, widgets, and title when the active scope/generation changes.
- Snapshot messages and the live assistant assembler are separate. Settlement,
  compaction, and sequence uncertainty trigger an authoritative refresh rather
  than renderer-side transcript invention.
- A same-generation, same-session `get_state` refresh reports only the pending
  queue count, not queue text. Preserve already observed `queue_update` details
  while that count still matches. Queue-mode commands update their confirmed
  mode locally and must not start a full hydration that hides or remounts the
  open queue surface. A changed count or session/generation reset clears details.
- Session statistics are authoritative and nullable. Cost is formatted from
  `totalCost`; missing statistics display no invented zero.
- Extension dialog responses include the request ID and generation. Strip ANSI
  control sequences only when rendering one-way notification/status/widget/
  title text; do not rewrite the protocol object in Main.
- RPC events and extension-UI events from one Host share one ordered Main
  forwarding chain. The renderer may receive response UI before the official
  user entry that anchors the response; ordering must not be reconstructed from
  timestamps or independent listener promises.
- Response activity identity is
  `{ scopeKey, generation, sessionId, anchorEntryId, activity.id }`. A prompt
  creates an operation-token pending provenance record before dispatch. While
  that operation has no authoritative user entry, buffer only its matching
  notification/status/widget/working/retry/error activity, with the same
  bounded DTO rules as ordinary activity. When the official user entry arrives,
  move the buffered records to that exact anchor atomically. After command
  acceptance, an authoritative snapshot may provide the anchor only when its
  message count advanced beyond the captured initial count. Failure clears only
  the matching operation token; scope/session/generation replacement clears the
  entire pending record. Never attach startup/global or stale-operation UI to a
  later response. When the submitted text is an exact extension command from
  the current command catalog and the command settles without producing an
  authoritative response anchor, promote its buffered one-way UI to the bounded
  global notification surface, mark that promoted item for one automatic reveal,
  and clear that exact pending operation. Consume the reveal marker immediately
  when opening the notification surface so ordinary renders, dismissal, and
  later scope updates cannot reopen it.
- Project response activity inside the authoritative response group. When a
  response settles, keep notifications, warnings, errors, extension errors,
  and retry failures; compress ordinary working/status/widget/retry progress to
  the latest final summary for that anchor. Unbound activity remains in the
  ActivityRail notification surface and must not also appear in the transcript.
- Passive tool data is renderer presentation, not an editable JSON surface.
  Select package-specific presenters only by exact tool name and keep a bounded
  structured-value fallback for unknown tools. The fallback uses semantic
  Arguments, Progress, Result, Error, and Patch disclosures; it must not dump
  `JSON.stringify` output into an unbounded `<pre>` element.
- The exact `subagent` presenter owns a concise Codex-style disclosure. Its
  collapsed row contains only the tool name, bounded agent/task summary, and
  lifecycle status. Expanded details render cleaned delegated task and
  meaningful output through the existing safe Markdown pipeline. Internal
  envelopes, the leading active-task routing line, workflow identifiers,
  fan-out accounting, `subagent_wait` guidance, and detached scheduler
  acknowledgements are not user-facing result content. Meaningful paths and
  instructions in the delegated task body remain visible. Treat an
  acknowledgement as lifecycle state and omit it from details. Result-only
  updates merge into the existing task presentation instead of replacing it
  with an empty generic record.
- Within one authoritative response group, replace only contiguous tool turns
  with renderer-owned activity runs. Classify from `ToolCall.kind` and the
  exact subagent presentation, preserve source order, and split at every
  assistant narrative, notice, plan, or response action. One call renders
  directly; repeated adjacent calls of the same category may use one compact
  count/status disclosure. This is a display projection only: transcript turns,
  response anchors, typewriter state, and Pi protocol records stay unchanged.
- Only exact subagent activity opens contextual Inspector detail. Store
  `{ sessionKey, toolCallId, sequence }` and resolve the current call from the
  active transcript on every render; never cache task, timeline, result, or
  status in navigation state. Scope/session/generation replacement immediately
  invalidates the detail. The contextual layer keeps the existing Inspector
  tab subtree mounted, defaults delegated task Markdown to a secondary closed
  disclosure, follows observable timeline updates while near the bottom, and
  restores focus to the originating row when closed.
- Bash/shell presentation is command-first: keep the bounded command in the
  collapsed row and disclosure, and show observable progress/result/error
  separately. Do not render or copy the generic argument object (cwd, timeout,
  and repeated command) as an Arguments section. Format output through the safe
  Markdown renderer only when it contains clear Markdown structure and no ANSI,
  carriage-progress, JSON, tabular, or log-heavy terminal signal. Otherwise
  show Raw. Eligible output exposes Formatted/Raw controls; copy always uses the
  same UTF-8-bounded source string rather than rendered DOM text.
- On mount, attach runtime, RPC-event, and extension-UI listeners before sending
  `rendererReady`, then read the runtime status snapshot. First hydration of a
  session within the same generation must retain startup extension surfaces;
  a real generation or session replacement clears them.
- Project session rows use opaque catalog `selectionToken` identities. Duplicate
  official session IDs may coexist and must not become React keys or rename IDs.
  Every row selection must invoke catalog activation with its token; never skip
  activation merely because the scope and `sessionId` match the current view.
- Selecting or creating another Session is navigation, not cancellation. Do
  not show a stop-and-switch confirmation and do not issue abort/stop for the
  prior Runtime. A running retained Session remains in the catalog, keeps its
  status, and can be selected again with one click. Stop targets only the
  currently selected exact Runtime.
- Rename uses the row's opaque selection token and never activates the Session
  as a side effect. Keep inline editing local until Main confirms the exact
  token-selected Session and the scoped catalog refresh publishes its name.
- Each available saved project keeps a stable New session action in its
  project-owned menu regardless of whether its catalog is empty, populated,
  loading, or temporarily unavailable. The ready-empty Start task row is only a
  shortcut to the same callback, not a separate lifecycle.
- A session selection has two renderer phases. Before
  `sessionCatalog.open(selectionToken)` returns Main's confirmed
  `{ scope, sessionId, generation }`, keep the row, conversation, and inspector
  in `loading` regardless of unrelated startup generations. After confirmation,
  settle only when that exact generation and session ID are ready and their
  session/transcript hydration is complete for the same scope. Scope is part of
  hydration identity even when generation and session ID happen to be unchanged;
  caches and async commits use `{ scopeKey, generation, sessionId }`. Runtime
  generations are not globally ordered: after selecting another Runtime, its
  generation may be lower than the previously selected Runtime's generation.
  Any non-exact scope/generation/session snapshot remains pending rather than
  being classified by numeric ordering. A terminal snapshot for the exact
  target generation is an error. Superseding session/scope operations abandon
  the old waiter by operation identity. App unmount/HMR clears refs and resolves
  the waiter without calling setState.
- One presentation discriminator gates all session-owned renderer data. It is
  `ready` only when active scope, selected catalog session, runtime generation,
  runtime session ID, and authoritative hydration all agree. While empty,
  loading, or failed, do not render the previous transcript, model, statistics,
  queue, extension surfaces, or Pi Session inspector data. Center the loading
  state in the available conversation/inspector region.
- Completed assistant responses end with Copy and Fork icon actions. Copy uses
  the response's source Markdown, not rendered DOM text. Fork provenance comes
  from the active official `get_entries` path: associate the complete assistant
  response with its preceding user entry and issue official `fork` directly with
  that user `entryId`. Do not call `get_fork_messages` or show a second picker.
  A successful non-cancelled fork uses the official returned `text` as the new
  Composer draft. The session-changing runtime snapshot may arrive before the
  command response; do not reject that response merely because its generation
  changed. Apply the returned draft only after the exact new
  `{ scopeKey, generation, sessionId }` hydration is ready. Let the Main runtime
  command/event chain refresh the catalog; do not start a competing renderer
  catalog refresh.
- Build the conversation outline from the authoritative chronological visible
  turn projection, then reverse a copy only at the inspector display boundary.
  The newest turn is the first DOM item; the transcript and projector stay
  chronological. Arrow Up / Arrow Down / Home / End follow this latest-first DOM
  order, while Enter and Space activate the exact official entry anchor.
- Composer image input accepts validated PNG/JPEG batches and sends official
  base64 `ImageContent`. Capture document revision, scope, and attachments before
  asynchronous conversion. Keep editing enabled while a command is pending and
  clear only the accepted captured revision in the same scope; later edits and
  later attachments survive.
- User turns preserve official Pi `ImageContent` through the transcript
  projection and render supported PNG/JPEG attachments inside the owning user
  message after send and Session rehydration. Never validate this flow only at
  the outgoing command or `get_messages` response: assert the rendered image as
  well. Unsupported or malformed image content degrades to a bounded placeholder
  and must not open a remote image channel.
- Composer submission uses the persisted `composer.sendShortcut` setting.
  The default is plain Enter; the alternate mode accepts Ctrl+Enter on
  Windows/Linux and Ctrl/Command+Enter in the renderer. Shift+Enter always
  inserts a line break. An open `/` or `@` picker owns unmodified Enter before
  submission, and IME composition/key code 229 must never submit.
- MCP settings describe `pi-mcp-adapter` as PiPilot's managed recommended
  global package. Automatic installation is best-effort and visible in
  Integrations; explicit removal opts out. Saving config may schedule a
  controlled Pi restart bound to the generation that observed the change.
- Inbound PiPilot External Control is a separate Main-owned integration. The
  renderer receives only a revisioned enable/state/client-count/configuration/
  recent-row snapshot through preload. The copied configuration contains no
  token; recent rows contain no raw IDs or content. `setEnabled` results and
  subscription events are applied monotonically by revision, and a new bridge
  generation clears prior recent rows before publishing `enabling`.
- Runtime rich-adapter facts are independent of the Integrations Settings tab's
  currently selected management scope. For a project conversation, load both
  global and that exact project snapshot for the active process generation;
  project npm package identities shadow global identities. For projectless,
  load global only. Reject late scope/generation results instead of applying
  them to a replacement runtime.
- Rich adapters are a closed set: exact-version Plan Mode and Goal. Each
  requires an exact supported manifest version and `sourceType === 'npm'`, plus
  an active official command reporting the same package source, package origin,
  and matching user/project scope. An unsupported project override must shadow
  a supported global version rather than reactivate it.
  Missing or malformed capability evidence keeps the official generic
  tool/message/status/widget presentation.
- A rich Plan block accepts only versioned, bounded `plan_mode_complete`
  details or the exact supported `proposed-plan` custom surface. Only the latest
  producing Plan turn owns actions; earlier Plan history remains readable with
  no active controls. Planning without Markdown may expose only lifecycle-valid
  actions such as Finalize and Exit. Direct controls send verified `/plan`
  routes through the normal official prompt/hydration path; Revise is an
  ordinary Plan-mode prompt.
- A rich Goal block accepts only `@narumitw/pi-goal@0.52.2` and the latest
  bounded `goal-state` custom Session entry. Session/scope/generation identity
  remains authoritative; the internal goal ID is used only as a stale-state
  identity and is never rendered. Status/Pause/Resume/Clear travel through the
  existing official prompt path, while starting or editing an objective stays
  in Composer through `/goal`.
- Official Pi retry events and settings exclusively own attempt count, delay,
  cancellation, recovery, and final failure. `pi-retry` is not a rich adapter.
  Summarization retry is a separate projection. Stop failures are scoped to the
  current retry identity so a late rejection cannot appear on a later attempt.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Event generation differs from active runtime | Ignore without mutating view state |
| Selected session and hydrated scope/runtime/session/generation do not agree | `loading`; hide all previous session-owned data |
| Scope changes while generation/session ID stay equal | Reset and re-hydrate the complete scope/generation/session identity; never reuse the previous scope's ready cache |
| An unrelated startup generation becomes ready before the selected catalog open is confirmed | Keep the selected row and both content regions `loading`; do not settle or render `empty` |
| Runtime snapshot generation differs from the confirmed target | Keep the opening pending; generations from different selected Runtimes are not numerically comparable, and a stale operation must not settle a newer opening |
| Runtime replacement or hydration fails | `error`; do not leave an indefinite spinner or restore stale data |
| Session-changing command succeeds but its confirming `get_state` fails | reject with `PI_SESSION_CONFIRMATION_FAILED` and end loading; never report a half-hydrated success |
| Event sequence is uncertain | Mark snapshot refresh; do not synthesize missing content |
| Same-session refresh reports the same pending queue count | Preserve authoritative `queue_update` text and the open queue surface; update only snapshot-backed fields |
| Queue count changes without a matching `queue_update` | Drop stale queue text and expose count-only state |
| Model/statistics RPC fails | Keep typed error or `null`; do not use mock data |
| Command catalog is unavailable/loading/failed | Show that exact state with no selectable stale rows |
| Scope, session, or runtime generation changes while a Composer picker is open | Close/reset both pickers, invalidate searches, remove old trusted atoms without history, and ensure undo/redo cannot restore them; retain ordinary text under the existing draft lifecycle |
| Pi reports an invalid `skill:` name or a duplicate command name | Exclude invalid skill names; preserve Pi order and keep the first exact name |
| User selects a direct slash candidate | Insert the trusted atom for a Skill or exact plain invocation for a non-Skill command; never auto-submit or navigate to a second level |
| Leading executable slash text conflicts with a selected Skill | Keep one representation; disable/reject the conflicting selection with a localized reason |
| Mention query is loading, empty, or failed | Keep the grouped popup and accurate `aria-expanded`; expose a status row and no invalid active descendant |
| Editor is composing or receives key code 229 | Do not open/select a mention and do not submit |
| Pasted HTML contains mention-like attributes | Insert plain text only; never trust clipboard node attributes |
| Dialog response belongs to stale generation | Reject as replaced and remove stale dialog |
| Response UI arrives before the prompt's official user entry | Buffer it under the exact prompt operation and scope identity; do not expose it as the previous response or guess an anchor |
| The prompt operation is accepted and a later authoritative snapshot has more messages | Use only the latest official response anchor, then atomically project the buffered activity |
| A registered extension command settles without creating a user/assistant turn | Promote its buffered one-way UI to the bounded global notification surface immediately and automatically reveal it once; do not leave it hidden for a future prompt or repeatedly reopen it |
| Prompt failure, superseding prompt, or scope/session/generation replacement occurs before anchoring | Clear only the matching pending operation; stale activity must not attach to a later response |
| Several ordinary progress surfaces settle for one response | Render only the latest settled summary; retain every warning/error/notification that remains actionable or historically meaningful |
| Response activity has no reliable official user anchor | Keep it in the bounded global notification surface; never duplicate it in the transcript |
| Unknown tool returns nested, malformed, deep, or large data | Use the bounded structured fallback with truthful malformed/truncated/unsupported states; never recurse without limits or expose an unbounded raw dump |
| `subagent` task arguments are valid | Show a concise collapsed identity; reveal cleaned task Markdown only after explicit disclosure |
| `subagent` result contains only scheduler acknowledgement text | Derive running/detached lifecycle state and omit the acknowledgement from visible result details |
| A later `subagent` result arrives without repeated arguments | Merge it with the prior task presentation; preserve the task identity and Markdown |
| `subagent` arguments are malformed or exceed safety limits | Show a localized truthful error/preview-limit state; do not fall back to raw protocol JSON |
| Tool activity is separated by narrative, notice, plan, or response action | End the current activity run and preserve that non-tool turn in its exact source position; never aggregate across it |
| A subagent detail selection no longer matches the current session/generation or exact tool call | Remove the contextual detail before rendering and ignore any late focus request |
| Subagent detail is closed | Reveal the previously mounted Inspector tab and return focus to the originating row when its exact identity still exists |
| Bash/shell tool includes command plus transport arguments | Show the command and observable output/error; omit the redundant generic Arguments section and do not copy cwd/timeout metadata |
| Bash output has clear Markdown and no terminal signals | Default to Formatted and keep an exact Raw view over the same bounded source |
| Bash output is ANSI, carriage-progress, JSON, tab-delimited, log-heavy, or ambiguous prose | Default to Raw; never reinterpret it as Markdown |
| A first live assistant update already contains a large cumulative chunk | Start display from empty and advance through the bounded typewriter; history hydration still renders immediately |
| Markdown is still streaming or the typewriter is catching up | Parse the visible prefix without syntax highlighting; restore highlighting only after the rendered text is stable, and disable decorative motion under reduced motion |
| Image type/count/size is invalid | Keep draft and attachments; show validation error |
| Selected model does not support images | Disable/add error; never silently drop images |
| Session selection changes while the previous Runtime is generating | keep the previous Runtime running in Main, reset renderer-owned surfaces to the selected Runtime, and allow one-click reselection |
| Rename targets a non-selected Session | rename by opaque catalog token without changing the active conversation |
| Context search is projectless or stale | Disable or reject; never infer a cwd in renderer |
| Response has no reliable preceding official user entry | Keep Copy available and disable Fork with an explanation |
| Submit succeeds | Clear only the captured document revision and captured images when scope and revision still match |
| Submit fails | Preserve the structured draft and images for retry |
| Project package overrides a global rich-adapter package | Select the project npm identity first; an unsupported project version disables rich adaptation and leaves generic presentation |
| Adapter package snapshot arrives for a stale runtime generation/scope | Ignore it and keep rich adapters disabled until the matching snapshots settle |
| Plan capability/detail/status/widget validation fails | Preserve the generic source surface and expose no rich Plan actions |
| An extension publishes a `retry` status | Keep official retry activity authoritative; treat the status as an ordinary generic extension surface |
| Stop rejects after the retry identity changed | Ignore the stale failure; do not mark the next attempt failed |

## 5. Good / Base / Bad Cases

- Good: a generation-tagged `get_state` snapshot seeds the projector, official
  events update the live view, and settlement refreshes authoritative messages
  and cost.
- Good: clicking a session immediately marks its row and content as loading;
  the previous session stays hidden until Main confirms the selected generation
  and that exact generation is fully hydrated, then ready replaces loading in
  one presentation transition.
- Good: the outline receives chronological source items, displays a reversed
  copy with the newest turn first, and navigates by the same visual order while
  the middle transcript remains unchanged.
- Good: typing `/` projects official Commands and Skills in one list; selecting
  a reported Skill creates the same editable atom as typed `@`, then
  serialization produces the exact leading `/skill:name` invocation.
- Good: a project-scoped supported Plan package shadows the global package,
  matches the project `/plan` provenance, and only its latest completed Plan
  turn exposes direct actions.
- Good: official retry waiting shows attempt/countdown/Stop from Pi Core only;
  installed retry extensions cannot alter that projection.
- Good: a prompt emits a widget before `entry_appended`; the renderer buffers it
  by operation token, receives the official user entry, and inserts the widget
  in that response group before Copy/Fork. A later settled status is compressed
  into the response's one final progress summary.
- Good: `/goal` completes through `ctx.ui.notify` without a user or assistant
  entry. The notification surface opens once with the command result, consumes
  its reveal marker, and the next prompt remains immediately sendable.
- Good: one response runs two Bash calls, reads a file, then explains the
  result. The two adjacent Bash calls share one command disclosure, the file
  remains in source order, and the explanation still appears after the tool
  evidence. Clicking a subagent row opens its live execution timeline in the
  Inspector without unmounting the prior Files/Changes/Outline/Terminal tab.
- Good: selecting `src/App.tsx` and a Skill, then authoring `review`, sends
  `/skill:name [@src/App.tsx](src/App.tsx) review` through every submit mode.
- Base: the embedded Host cannot start or crash. The renderer shows the typed
  crashed/error runtime state, keeps project navigation usable, and offers no
  fake model or skill list.
- Bad: merge old-generation deltas, use `sessionId` as a unique sidebar key,
  trim the user's prompt, expose absolute context paths, append a referenced-path
  block, trust pasted mention HTML, scan `~/.pi` for skills, or clear later edits
  and attachments after an older command succeeds. Also bad: attach an
  extension event to whichever response is currently last, or render transient
  status, widget, and working rows after all of them have settled.

## 6. Tests Required

- Projector unit tests assert generation rejection, queue/steer settlement,
  live assistant assembly, retry/compaction transitions, and refresh flags.
- Live-response tests assert bounded character advancement; real Electron
  coverage must observe typing state before a large one-delta response becomes
  fully visible. Streaming Markdown defers syntax highlighting. Thinking opens
  while streaming, closes after settlement, and remains manually expandable.
- Pending-response tests assert pre-entry capture and atomic flush, operation
  token isolation, exact scope/generation/session rejection, accepted snapshot
  fallback only after message-count advancement, settlement, reset, and the
  bounded pending-activity limit. Electron coverage must also execute a real
  registered extension fixture that only calls `ctx.ui.notify`, assert that its
  result becomes visible without opening the notification surface manually,
  and prove the following ordinary prompt is accepted.
- Response-activity tests assert exact anchor filtering, global fallback without
  duplication, latest-settled-progress compression, and preservation of
  notifications/warnings/errors. Electron coverage asserts the settled final
  summary rather than every transient progress row.
- Tool-activity tests assert contiguous run boundaries, mixed-category source
  order, stable IDs, failure visibility, exact subagent classification, and
  unknown fallback. Shell-evidence tests assert Markdown heading/list/table
  formatting; ANSI/JSON/log/tab/carriage/raw defaults; UTF-8-safe truncation;
  and exact copy-source preservation.
- Contract tests assert exact official response/event schemas and private
  command rejection.
- Composer tests assert structured serialization, Markdown escaping, canonical
  path deduplication, one-Skill replacement/extraction, slash conflicts,
  malformed-node rejection, revision-safe clearing, image conversion, validation
  bounds, and failure retention.
- Slash projection tests assert Pi order, exact-name first-wins behavior, valid
  skill filtering, direct Commands + Skills grouping, path-free metadata search,
  wrapping keyboard navigation, and leading-token recognition.
- Adapter tests assert the closed registry, exact npm/version/provenance gates,
  project-over-global package identity precedence, malformed generic fallback,
  latest Plan action ownership, no-Markdown lifecycle controls, official retry
  authority, status-only enrichment, and retry identity cleanup.
- Electron tests assert real Main/preload/renderer model switching, queue/steer,
  extension surfaces, project context search, rendered user images plus their
  official payloads, scope reset, and
  same-ID catalog rows still performing a full official session activation.
  They also assert immediate loading, no stale transcript/inspector content,
  complete selected-session hydration, response-source copying, direct official
  entry-based forking, and fork draft restoration. The sidebar must not expose
  the removed session-level Fork picker. They also assert `@` path/Skill
  selection, exact outgoing serialization in Prompt/Follow-up/Steer, grouped
  async states, IME/229 suppression, safe clipboard/paste, accessible active
  descendants, pending-submit editing, direct Commands + Skills convergence,
  typed `@` Files + Skills, and scope-switch undo isolation.
  A preconfigured startup fixture must prove one-shot extension surfaces are
  received after the readiness handshake and repeated readiness is idempotent.
- Electron tool-activity coverage clicks an exact subagent call, verifies the
  contextual Inspector task disclosure and observable execution timeline,
  switches Bash output between Formatted and Raw without changing source,
  closes back to the prior Inspector tab, and asserts no page-level horizontal
  overflow at 1100x680 in dark mode.
- Session-opening tests assert the Main-confirmed generation/session identity,
  matching scope, unrelated startup generations, superseding operations,
  unmount waiter cleanup, and selection from a higher-generation Runtime to a
  lower-generation Runtime,
  and a single-click Electron transition that observes loading until ready and
  never observes an intermediate empty state.
- The real SDK composite starts a delayed prompt in Session A, creates Session
  B without stopping A, reselects A while it is still running, observes A's
  transcript and Stop action, stops only A, and renames A through its row.
- Outline tests assert the chronological projector is not mutated, the inspector
  displays newest-to-oldest, and focus navigation follows that visual order.
- Packaged tests assert the facade works without an embedded Pi SDK.

## 7. Wrong vs Correct

Wrong:

```ts
setMessages((items) => [...items, event as Message])
await api.prompt(text.trim(), [])
setAttachments([])
if (activeSessionId === row.sessionId) return
setTranscript(previousSessionMessages)
const skills = await scanSkillDirectories('~/.pi', '.pi')
const adapterPackages = settingsUiSnapshot.packages
if (retryStatus === 'retrying') startAnotherRetryLoop()
const toolCards = responseTurns.map((turn) => <ToolCallCard call={turn.call} />)
setSubagentDetail(selectedCall)
const shellMarkdown = markdownRenderer.render(call.output)
```

Correct:

```ts
if (envelope.generation !== runtime.generation) return
const next = applyLocalPiProjectorEvent(projector, envelope)
const presentation = derivePiConversationPresentation({
  activeScope,
  activeSessionId,
  runtime,
  hydration,
})
if (presentation.status !== 'ready') hideSessionOwnedData()
const pending = createPiPendingPromptProvenance({
  operationId,
  scopeKey,
  generation,
  sessionId,
  initialMessageCount: projector.messages.length,
})
const pendingWithActivity = capturePiPendingPromptActivity(
  pending,
  currentScope,
  activity,
)
if (extensionCommandSettledWithoutAnchor(pendingWithActivity)) {
  promoteToGlobalNotifications(pendingWithActivity, { autoReveal: true })
  clearPendingPrompt(pendingWithActivity.operationId)
}
const anchorEntryId = piPendingPromptSnapshotAnchor(
  acceptPiPendingPrompt(pendingWithActivity, operationId),
  currentScope,
  projector,
)
const commands = projectComposerCommands(activeOfficialCommands)
const activitySequence = projectToolActivitySequence(responseTurns)
const shellEvidence = projectShellEvidence(call.output ?? '')
const subagentSelection = {
  sessionKey: activeConversationKey,
  toolCallId: call.id,
  sequence: nextSelectionSequence(),
}
const adapterPackages = dedupeRuntimeAdapterPackages([
  ...globalSnapshot.packages,
  ...activeProjectSnapshot.packages,
])
const adapterCapabilities = detectRichAdapterCapabilities({
  packages: adapterPackages,
  commands: activeOfficialCommands,
})
const mentionCandidates = projectComposerMentionCandidates(pathEntries, commands.skills)
const selectedSkill = mentionCandidates.skills.find(
  (candidate) => candidate.commandName === selectedName,
)
if (selectedSkill) editor.replaceLeadingSlashWithMention(selectedSkill)
const capturedScope = scope
const captured = editor.capture()
const message = serializeComposerDocument(captured)
if (message === null) return showInvalidDocumentError()
await actions.send(
  message,
  'prompt',
  await Promise.all(images.map(attachmentToPiImage)),
)
if (shouldClearCapturedComposer(
  capturedScope,
  currentScope,
  captured.revision,
  editor.capture().revision,
)) {
  editor.clearIfRevision(captured.revision)
}
```
