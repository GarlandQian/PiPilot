# Implementation plan — Pi Plugin Lag Refactor

The task is active. The user approved a direct breaking cutover: do not build or
retain a compatibility facade, dual backend, silent fallback, or migration for
the previous CLI/JSONL runtime.

## [x] Phase 0 — Contract and specification correction

- Pin exact `@earendil-works/pi-coding-agent@0.84.2` as a production dependency
  only after the package closure and package-manager lockfile are reviewed.
- Update `src/shared/local-pi.ts` for Pi 0.84.2 DTO drift, including cumulative
  `message_update.usage`, while keeping renderer-facing schemas centralized.
- Add a shared host protocol module for versioned envelopes, host epoch,
  runtime ID/generation, request IDs, event sequence, credit/ack, bounded
  errors, and clone-safe payloads.
- Correct `.trellis/spec/backend/local-pi-rpc.md` only after the implementation
  is accepted; until then the pinned official Pi 0.84.2 RPC fixture is the
  semantic parity oracle and the current CLI implementation is historical
  reference only.

## [~/x] Phase 1 — Packaged Utility/MessagePort feasibility spike (code+config done; real packaged smoke remains a CI gate)

- Add a dedicated electron-vite utility entry under `src/main/pi-host/` or the
  equivalent project-approved entry path; do not assume a renderer adapter that
  does not exist.
- Spawn the utility only after `app.whenReady()`, transfer a
  `MessageChannelMain` port, and prove versioned handshake, ping/pong, port
  close, utility exit, bounded restart, and application shutdown.
- Import only public Pi SDK exports in the utility and create one isolated
  persisted fixture Runtime with a temporary agent directory/cwd.
- Probe structured clone rejection, DTO validation, large payload bounds, and a
  bounded credit/ack window before any streaming integration.
- Build unpacked and packaged artifacts and inspect the ASAR/unpacked closure;
  execute native, WASM, image-worker, and external TS/Jiti extension paths.
- Run the spike on macOS arm64/x64, Windows x64, and Linux x64 as a blocking
  implementation gate; official Pi 0.84.2 fixtures are the parity oracle.

## [x] Phase 2 — Main Host controller and direct contract replacement

- Add `PiHostController` under `src/main/pi-host/` to own utility spawn,
  MessagePort, host epoch, request correlation, bounded queues, crash/exit,
  diagnostics, and disposal.
- Replace shared IPC, Preload, Main consumers, and Renderer providers with the
  new Host/Runtime identities as one coordinated cross-layer contract change.
- Preserve generation-safe snapshots/events/UI listeners and reject pending
  work exactly once on replacement, port close, or Host crash.
- Delete legacy host/pool/executable/JSONL types and tests after their new
  equivalents are connected; do not add a backend selector.

## [x] Phase 3 — SDK RuntimeManager and project Host registry (per-scope Hosts; no fixed production concurrency count)

- Add utility-side `RuntimeManager` with a bounded `Map<runtimeId,
  AgentSessionRuntime>` scoped to one canonical project/projectless cwd.
- Implement create/open/new/switch/fork/clone/dispose using public SDK runtime
  APIs and authoritative SessionManager paths.
- Keep Session catalog listing independent from Runtime allocation; catalog rows
  do not start Hosts or Runtimes.
- Do not impose fixed active Host/Runtime counts or a numeric-capacity queue.
  Keep per-Runtime generation/sequence/UI namespaces and never share unrelated
  project cwd values in one Host.
- Retain every running Runtime. Reclaim only durably persisted inactive
  Runtimes above the bounded per-Host idle cache, ordered by LRU. Before
  disposal revalidate tracked activity plus official `get_state`; activity,
  pending extension UI, queued work, missing Session persistence, or a stale
  generation cancels reclamation. Runtime disposal must not remove the Session
  file or catalog row.
- Wire global/project package/config restart fan-out to affected Hosts only.

## [x] Phase 4 — RPC semantic projection and event parity (30+ command dispatcher; pinned-fixture parity follows in Phase 7 benchmark runs)

- Split the utility implementation into command dispatch, state projection,
  event conversion, Runtime binding, extension UI bridge, and transport.
- Reproduce the currently supported official RPC commands through public SDK
  methods: prompt/steer/follow-up/abort, model/thinking/queue, compact/retry,
  bash, stats/export/messages/commands/entries/tree, session naming, and
  new/switch/fork/clone.
- Rebind Session subscriptions and extension contexts after every replacement;
  preserve event order and stale-generation rejection.
- Compare command responses and event streams against a pinned official CLI RPC
  fixture after removing only transport metadata. Include deep trees, large
  messages, bash streaming/abort, retry, compaction, and model changes.
- Reuse the existing Main iterative tree projection and Renderer projector;
  remove no renderer state model merely because transport changes.
- Project public extension-command argument providers generically: advertise
  capability in `get_commands`, invoke the exact current Session command through
  `getArgumentCompletions`, enforce a bounded clone-safe DTO and timeout, and
  connect it to the existing Composer picker with request identity, current-
  prefix replacement, IME-safe keyboard navigation, and stale-result rejection.

## [x] Phase 5 — Extension UI liveness bridge

- Implement portable `select`, `confirm`, `input`, and `editor` request/response
  handling plus notify/status/string-widget/title/editor-text events.
- Add Host-owned deadlines for every blocking request, including editor without
  a plugin timeout.
- Emit explicit opened/resolved/cancelled/expired/replaced/crashed terminals;
  make Renderer dismissal and late responses idempotent.
- Preserve official TUI-only degradation instead of inventing GUI components.
- Test runtime replacement, Host crash, dialog dismissal, timeout, and late
  response for every supported dialog method.

## [x] Phase 6 — Direct product cutover

- Connect Session catalog activation, scope/header validation, observed
  directory invalidation, workspace loading, hydration, MCP, models, and package
  helper flows directly to the Host/Runtime services.
- Delete capability-probe double initialization, external executable discovery,
  CLI spawn/shim handling, JSONL transport, legacy settings/copy, and obsolete
  tests/fixtures in the same cutover.
- Do not preserve deprecated DTO fields or persistence migrations solely for
  code that has never been released under the new architecture.

## [~] Phase 7 — Benchmark and plugin compatibility decision (needs packaged app on real plugins/user machine)

- Measure current CLI, current CLI without capability probe, cold embedded Host,
  first Runtime, second same-cwd Runtime, warm Runtime selection, same-cwd
  replacement, cross-cwd Host creation, hydration, crash recovery, and disposal.
- Record p50/p95/max timings and RSS/heap/external memory at 1/4/8 Runtime
  capacities. Set budgets only from these samples.
- Test sanitized representative plugins: MCP, subagents, exact Plan Mode,
  exact Goal, file/presentation, timers/children, and portable extension UI.
  Exercise retry through Pi Core only; `pi-retry` is not a supported rich
  adapter.
- Classify plugin behavior as compatible, host-scoped-only, or unsupported;
  document any process-global/native limitation rather than silently changing
  scope.

## [~] Phase 8 — Final quality gate and cleanup (typecheck/build/unit green; package:dir + platform smoke pending user-side)

- Session replacement now has an explicit activation transaction. Pool
  snapshots cannot interpret failed-candidate disposal as a Host crash and
  evict healthy sibling Runtime caches. Recoverable activation/hydration races
  retry once; a terminal failed selection restores the previous healthy Runtime
  while returning a typed error to the requested row.
- Foreground Session selection is no longer Runtime ownership. Runtime commands
  capture exact identity before awaiting, commands are serialized per Runtime
  rather than behind the global selection lifecycle, and selecting/creating
  another Session does not stop an accepted background prompt. Reselecting the
  running Session hydrates it from the retained Runtime and exposes its Stop
  action; late completion cannot overwrite the newer foreground selection.
- Catalog rename resolves the opaque row token and mutates the exact owning
  Runtime or persisted Session through Main without activating it. Active and
  inactive Session rows share the same verified rename result and scoped
  catalog invalidation.
- PiPilot is tray-resident: normal main-window close hides rather than destroys
  the BrowserWindow, active SDK work continues, and the tray exposes Show/Quit.
  Explicit Quit/update installation still uses bounded application cleanup.
- Electron reliability coverage includes delayed cold startup, persisted
  Session A → B → cached A reselection, repeated first-click runs, and a delayed
  real SDK prompt that completes while the main window is hidden. The real SDK
  composite also covers running Session A → new Session B → running A,
  Runtime-local Stop, and catalog-row rename.

- Long-running official Sessions are cataloged up to 64 MiB per file and Host
  responses are bounded at 64 MiB; the former 8 MiB catalog / 16 MiB transport
  limits no longer hide ordinary persisted conversations.
- Renderer workspace and hydration stores accept the Main-selected Runtime even
  when its per-Runtime generation is numerically lower than the previously
  selected Runtime; readiness still requires the exact confirmed
  `{ scopeKey, generation, sessionId }` target.
- Renderer command handling accepts a session-changing Runtime generation that
  is published before its command response. Fork keeps the official returned
  text pending until the exact new Session hydration is ready, then restores it
  as the Composer draft.
- Session-changing commands now transfer Main's active-scope bookkeeping from
  the source Runtime generation to the confirmed result generation. Session
  deletion determines active ownership from the Runtime's exact scope/file
  lease, so an otherwise valid current Session is stopped and deleted instead
  of being rejected as an inactive cached Runtime.
- Session catalog refresh now has a real foreground completion boundary. A
  continuous plugin/session invalidation stream publishes the last coherent
  scan after four scans or 250 ms and moves remaining convergence to a yielded
  background refresh, preventing a project row from staying on “Loading
  tasks…” forever.
- Scope navigation no longer revokes the previous project's independent
  catalog request. The request may finish into that inactive project's sidebar
  cache; only its active-session projection is scope-gated. This closes the
  second permanent-loading path where switching projects discarded the only
  pending result without starting a replacement.
- Restored expanded-project preferences now trigger the same scoped catalog
  load as a manual expansion. An inactive expanded project no longer renders an
  `idle` placeholder as a permanent loading spinner while another project is
  active.
- Integrations Overview now presents installed packages and resolved resources
  as one compact navigable summary, omits zero-count Pi TUI themes, and shows
  actual installed-package compatibility groups with counts and descriptions
  instead of an empty compatibility explanation block.
- Replace the empty extension Theme placeholder with a plain-text headless
  Theme, project working message/visibility, and publish bounded deduplicated
  observations for actually-invoked TUI-only methods.
- Add a shared package adapter registry for `pi-mcp-adapter`, `pi-subagents`,
  exact Plan Mode, and exact Goal; remove all `pi-retry` capability/status
  enrichment while preserving Pi Core retry activity and settings.
- Project `@narumitw/pi-goal@0.52.1` from the latest validated `goal-state`
  Session entry and matching official command provenance. Keep it user-managed,
  hide internal goal IDs, and expose only lifecycle-valid direct controls.
- Add a Main-owned, single-flight, best-effort global install for
  `pi-mcp-adapter`. Keep it visible as an ordinary managed package, persist an
  opt-out after explicit removal, and surface failure without blocking chat.
- Prefer in-place Host Runtime resource reload/rebind after package mutations;
  restart only affected Hosts when reload fails. Add a PiPilot-owned subagents
  child-runtime compatibility shim without editing third-party package files.
- Replace the Overview compatibility matrix with a compact active-runtime
  support/problem summary. Keep package/resource details available in their
  existing tabs and present Pi TUI themes as a quiet boundary note rather than
  a primary integration category.
- Add focused public-SDK command argument completion coverage for provider
  semantics, capability discovery, no-provider behavior, bounds/timeout/schema,
  `/goal r`-style whitespace parsing and application, keyboard navigation, and
  stale text/scope/Session/generation results. Do not add package-name-specific
  completion adapters.
- Flush portable UI from a settled registered extension command to the global
  notification surface when no official response anchor exists, reveal the
  promoted result once, and consume that reveal marker immediately; keep
  ordinary prompt provenance unchanged and cover the behavior in real Electron.

- Run focused unit/parity tests, `pnpm typecheck`, `pnpm build`, `package:dir`,
  packaged smoke, and platform Electron workflows on the same worktree.
- Verify no raw SDK objects, private Pi deep imports, stale event generations,
  unbounded queues, or obsolete external-executable production paths remain.
- Update backend/frontend specs with the accepted embedded-host contracts and
  record the benchmark results.
- Verify all CLI/JSONL/executable-discovery product paths are deleted.
- Do not commit or publish until the user reviews the final verification report.

## Risky files and rollback points

- `package.json`, `pnpm-lock.yaml`, `electron.vite.config.ts`,
  `electron-builder.yml`: SDK dependency and packaged utility entry.
- `src/main/index.ts`, `src/main/local-pi/local-pi-runtime-host.ts`,
  `src/main/local-pi/local-pi-runtime-pool.ts`: composition and deletion seams.
- `src/main/ipc/register-local-pi-ipc.ts`, `src/shared/local-pi.ts`,
  `src/shared/ipc/contracts.ts`, `src/shared/pipilot-api.ts`,
  `src/preload/index.ts`: cross-layer contracts.
- `src/store/pi-rpc.tsx`, `src/renderer/pi-rpc/projector.ts`: renderer event
  consumption; preserve existing generation/loading semantics.
- `src/main/local-pi-management/*`: bundled SDK helper and restart fan-out.

Rollback is source-control-level only. The implementation may delete obsolete
runtime files directly, while preserving unrelated user changes and avoiding a
destructive repository-wide reset.
