# Builtin updates, conversation MCP control, and documentation sync

> **Current implementation note (2026-08-22):** The Vite 8 lane passed and is
> retained at electron-vite `6.0.0-beta.1`, Vite `8.2.2`, and
> `@vitejs/plugin-react@6.1.0`. Vite 7 references below describe the planned
> fail-safe contingency, not the final selected worktree.

## Goal

Keep PiPilot's bundled and explicitly managed Pi stack current, expose a local
MCP control surface so trusted clients such as Codex can inspect every PiPilot
conversation and send prompts to an exact conversation without using the
desktop UI, and make every project-owned current document describe the final
verified worktree rather than an earlier implementation phase.

## Background

- PiPilot currently bundles exact `@earendil-works/pi-coding-agent@0.84.2` and
  validates that version in shared/Main Host contracts.
- `pi-mcp-adapter` is the only automatically managed recommended Pi package.
  It is installed into the user's global Pi package configuration, not bundled
  into the PiPilot application artifact.
- `pi-subagents`, `@narumitw/pi-plan-mode`, and `@narumitw/pi-goal` are currently
  user-managed packages with package-level compatibility/rich presentation.
  Plan and Goal rich adapters use exact-version gates.
- PiPilot already owns Main-side project Hosts, multiple Runtime/session
  identities, catalog activation, typed runtime commands, and renderer status
  projection. Existing Renderer IPC is not an external automation boundary.
- Existing MCP settings manage Pi's outbound MCP clients via
  `~/.pi/agent/mcp.json` or project `.mcp.json`; the requested feature is a new
  inbound PiPilot MCP server and must remain a separate security/lifecycle
  boundary.
- Authoritative npm metadata checked on 2026-08-21 reports bundled Pi
  `@earendil-works/pi-coding-agent@0.84.2` is already the current `latest`.
  PiPilot's exact rich-adapter pins lag upstream for Plan
  (`0.49.3` -> `0.50.1`) and Goal (`0.52.1` -> `0.52.2`). The currently
  unpinned managed/compatible packages report `pi-mcp-adapter@2.27.0` and
  `pi-subagents@0.53.0` as latest.
- A full direct-dependency inventory also reports newer application/build
  dependencies: Electron `43.3.0` -> `43.4.1`, the Tiptap suite `3.29.2` ->
  `3.30.2`, Vite `7.3.6` -> `8.2.1`, `@vitejs/plugin-react` `5.2.0` ->
  `6.0.5`, Vitest `4.1.10` -> `4.1.11`, `react-resizable-panels` `4.12.2`
  -> `4.12.3`, and `@types/node` `26.1.2` -> `26.2.0`. Vite/plugin-react are
  major migrations and must not be folded into the Pi migration implicitly.
- The official MCP TypeScript server SDK is now the split
  `@modelcontextprotocol/server@2.0.0`. Its documented local-client transport
  is stdio; stdout is exclusively the JSON-RPC protocol channel.
- Main already routes exact commands through `ProjectHostPool.command(runtimeId,
  command, expectedGeneration)` and publishes Host/Runtime summaries. The
  Renderer-facing `PiRuntimeFrontend.request()` intentionally targets only the
  selected Runtime, so an external control plane must bind to the Main pool (or
  a dedicated Main service over it), not Renderer IPC.
- The current documentation is not one coherent snapshot. `README.md` and
  `README.zh-CN.md` describe embedded Pi `0.84.2`, while
  `docs/ARCHITECTURE.md`, `docs/TEST_MATRIX.md`, and
  `docs/COMPLETION_AUDIT.md` still contain Pi `0.84.0`, the former single Agent
  Utility Process model, early test counts, and pre-public-release conclusions.
  `PRODUCT.md` also still describes the Runtime as the user's own local Pi
  installation. Historical phase reports are legitimate evidence, but several
  are not visibly distinguished from current documentation.

## Requirements

### R1 — Version inventory and upgrade policy

- Inventory every dependency or Pi package PiPilot bundles, automatically
  installs, or exact-version adapts; classify each as bundled, managed, or
  user-managed.
- Resolve current upstream releases from authoritative package metadata and
  inspect changelogs/types/source before changing a pin.
- Upgrade the bundled Pi SDK and every approved managed/exact-adapter version as
  one compatibility project, updating protocol handshakes, fixtures, packaging,
  tests, documentation, and user-visible version labels together.
- Do not silently install user-managed packages unless this task explicitly
  changes their ownership policy.
- Preserve current package ownership: PiPilot continues to automatically manage
  only `pi-mcp-adapter`. Subagents, Plan, and Goal remain user-managed; PiPilot
  updates their compatibility metadata/rich adapters and may offer explicit
  one-click install/update actions, but never silently mutates those global Pi
  package entries.
- Upgrade every outdated direct production and development dependency reported
  by the authoritative registry, including major toolchain migrations. Keep
  coherent dependency families on one exact compatible line (for example all
  Tiptap packages together), preserve the frozen pnpm lockfile contract, and
  verify each migration lane independently before the combined release gate.
- Treat the Electron, Tiptap, Vite/plugin-react, test/tooling, embedded Pi, and
  Pi package-adapter upgrades as separately diagnosable phases even though they
  ship in the same task.
- Attempt the absolute-latest Vite lane with `electron-vite@6.0.0-beta.1`,
  Vite 8, and `@vitejs/plugin-react@6`. Keep it only if the full strict gate
  remains green. If that lane introduces any unresolved gate failure, revert
  the complete lane to the latest stable-compatible electron-vite 5, Vite 7,
  and plugin-react 5 set and record the upstream blocker; do not weaken tests or
  product behavior to retain a beta toolchain.

### R2 — Local PiPilot MCP server

- Provide a local MCP server that trusted external clients can configure and
  launch without exposing Electron Renderer IPC or raw SDK objects.
- Expose a bounded conversation inventory covering project and projectless
  conversations, including stable opaque identity and truthful lifecycle state.
- "Every PiPilot conversation" means every official Session discoverable by
  PiPilot's existing bounded catalog for projectless and saved project scopes.
  An unobserved scope remains honestly `not_loaded`; the MCP server must not
  guess Pi's Session directory encoding or recursively scan arbitrary files.
- Include catalog-only conversations that do not currently own a Runtime. Their
  state is `inactive`, not `idle`.
- Allow a client to inspect an exact conversation's status and send a prompt to
  that exact conversation while other conversations remain active.
- Sending to an `inactive` conversation starts and binds its Runtime in the
  background without changing the desktop UI selection, then submits the
  prompt. Startup failure is isolated to that operation. The resulting Runtime
  follows PiPilot's existing rule that only idle retained Runtimes may be
  reclaimed; executing work is never reclaimed.
- Expose prompt submission with an explicit `auto | prompt | follow_up | steer`
  mode. `auto` is the default: it sends a normal Prompt to an idle conversation
  and queues a Follow-up when the target conversation is running. It must never
  silently Steer or Abort.
- Expose Abort as a separate explicit operation. Explicit `prompt`, `follow_up`,
  and `steer` modes preserve Pi's existing validation and fail truthfully when
  they are invalid for the target state.
- `send_prompt` returns immediately after PiPilot validates the request and
  atomically reserves its idempotency mapping and correlated operation ID. The
  response is `received`, not proof that Pi accepted the prompt. For `auto`, the
  actual accepted mode is unknown at this boundary and must not be guessed.
- Authentication/schema errors, unknown opaque conversation IDs, and
  idempotency conflicts fail synchronously without an operation. Target
  revalidation, Runtime startup, SDK rejection, or replacement after receipt
  terminate the already-returned operation truthfully.
- Pi acceptance is a separate authoritative transition
  (`preflightResult(true)` or the equivalent proven SDK boundary). Only then may
  the operation become `accepted` and expose `acceptedMode`.
- Expose bounded `wait_for_turn` and `get_operation` tools. Operations follow an
  explicit `received -> starting/accepting -> accepted -> completed | failed |
  aborted | runtime_replaced` state machine; a pre-acceptance failure may move
  directly from `received`, `starting`, or `accepting` to a terminal state.
  `wait_for_turn` accepts `until: accepted | terminal`. A wait deadline returns
  `timed_out` without changing the underlying operation or claiming failure.
- Accept a caller-supplied bounded idempotency key on mutating tools. Replaying
  the same key and identical request returns the original operation; reusing it
  with different input fails without sending another message.
- Commands must preserve Runtime/session/scope identity, prompt acceptance,
  queue/steer semantics, error typing, and replacement behavior already enforced
  by Main.
- The MCP boundary must use structured, clone-safe, bounded DTOs and must not
  expose filesystem session paths, secrets, model credentials, private extension
  state, or raw internal errors.
- Do not expose arbitrary existing transcript/history, raw prompts, tool
  arguments, or Session JSONL. Read tools return bounded conversation metadata
  and lifecycle state; operation tools may return only the bounded final
  response produced by that authenticated MCP operation.
- The server must have an explicit trust/authentication and lifecycle model;
  external clients must not gain ambient remote access merely because PiPilot is
  running.
- External control is disabled by default and enabled explicitly in Settings.
  Once enabled, it remains available while PiPilot is running without per-call
  confirmation dialogs. Disabling it closes active clients and invalidates the
  previous credential.
- Prefer a packaged stdio MCP entry launched by Codex/Claude Code. It must
  connect to the running PiPilot Main process through a separate authenticated
  local bridge (Unix-domain socket on macOS/Linux and named pipe on Windows),
  rather than listening on a remotely reachable TCP interface or importing
  Electron Renderer code.
- The MCP entry and Main bridge must negotiate a protocol version, authenticate
  with an installation-scoped capability, enforce request/response size and
  deadline bounds, and fail closed when PiPilot is unavailable or the capability
  is stale.
- Do not use Electron `safeStorage` or the operating-system Keychain for this
  capability. Persist only the minimum local bridge state in a current-user-only
  `0600` file and protect the Unix socket/named pipe for the current user.
- The initial MCP surface is tool-only: list/status/send/abort/get-operation/
  wait-for-turn. Resources, subscriptions and arbitrary transcript reads are
  not part of the MVP.

### R3 — Compatibility and observability

- Codex and other standard MCP clients must be able to discover the same stable
  tool schemas.
- MCP actions must be auditable in PiPilot and attributable to the target
  conversation and external client operation without fabricating transcript
  messages.
- Running conversations must remain independent; one client request, timeout,
  disconnect, or invalid identity cannot stop or retarget another Runtime.

### R4 — Repository-wide current documentation

- Treat documentation synchronization as a release requirement, not optional
  cleanup after code. Product code, tests, package metadata, current specs, and
  user/developer documentation must describe the same final worktree.
- Audit every project-owned Markdown document outside generated output,
  third-party packages, test fixtures, machine-local Skills, workspace journals,
  and archived Trellis task evidence. Classify it as current authority,
  historical snapshot, workflow/platform template, or fixture before editing.
- Rewrite the current user/product/developer authorities at minimum:
  `README.md`, `README.zh-CN.md`, `PRODUCT.md`, `docs/ARCHITECTURE.md`,
  `docs/PACKAGING.md`, and `docs/TEST_MATRIX.md`. Versions, process ownership,
  supported platforms, release/update behavior, commands, paths, security
  boundaries, feature availability, and test claims must come from the final
  manifest, source, workflow, and actually executed evidence.
- Update every affected current `.trellis/spec/backend/**`,
  `.trellis/spec/frontend/**`, and reusable cross-layer guide so future work is
  injected with the new embedded Pi, multi-Runtime, MCP bridge, operation, UI,
  packaging, and verification contracts. Do not edit an unrelated spec merely
  to create churn.
- Add a `docs/README.md` authority index that identifies which documents are
  current and which are historical. `docs/IMPLEMENTATION_PLAN.md`,
  `docs/COMPLETION_AUDIT.md`, and every `docs/PHASE_*_REPORT.md` must carry a
  consistent, prominent historical-snapshot notice linking to the current
  architecture/test/package authorities.
- Preserve historical dates, versions, commands, counts, findings, and claims
  as historical facts. Never rewrite an old report to pretend it described the
  new implementation; fix ambiguity with status notices and current-doc links.
- Planning/task research must remain explicitly future-facing until the feature
  is implemented. Archived Trellis tasks and per-developer journals remain
  evidence and are not bulk rewritten.
- English and Simplified Chinese README content must remain semantically paired.
  All copied commands and paths must be valid for the final packaged product and
  must not contain developer-specific absolute paths, credentials, or generated
  test artifacts.
- A documentation claim is allowed only when it can be traced to current source,
  configuration, package metadata, or a gate that actually ran. Unavailable
  native-platform evidence remains an explicit limitation.

## Acceptance Criteria

- [x] A reviewed inventory identifies every bundled, managed, and exact-adapter
      version, its upstream current version, and required migration work.
- [x] The upgraded embedded Pi Host passes protocol/parity, multi-Runtime,
      package compatibility, production build, packaging, and platform Electron
      gates on the same worktree.
- [x] A standard MCP client can list PiPilot conversations with stable opaque
      IDs and distinguish idle, accepting, running, queued, stopped, crashed,
      inactive, and unavailable states without receiving private paths or
      secrets.
- [x] Listing or inspecting conversations never allocates a Runtime, starts a
      Host, changes the selected desktop conversation, or reveals a catalog
      selection token.
- [x] A standard MCP client can send a prompt to an exact idle conversation and
      receive a correlated acknowledgement/error without selecting that
      conversation in the UI.
- [x] The default MCP send mode queues a Follow-up for a running target; explicit
      Steer and Abort affect only the exact target Runtime, and `auto` never
      changes or aborts the active turn.
- [x] `send_prompt` immediately returns one idempotent `received` operation ID
      without claiming Pi acceptance; `get_operation` and `wait_for_turn` expose
      the later authoritative `accepted` transition and distinguish completed,
      failed, aborted, runtime-replaced, and non-terminal wait timeout outcomes.
- [x] Retried mutating calls with the same idempotency key cannot duplicate a
      prompt or abort a different operation.
- [x] Concurrent prompts to different conversations remain isolated, and stale
      or unknown conversation identities fail without mutating any Runtime.
- [x] Sending to an inactive catalog conversation starts it in the background,
      leaves the desktop selection unchanged, and produces the same lifecycle
      and audit evidence as sending to an already loaded Runtime.
- [x] Authentication/trust, request bounds, timeouts, cancellation, audit
      visibility, shutdown, and client disconnect behavior are covered by tests.
- [x] External Control is disabled by default; enabling it exposes a copyable
      packaged command/arguments configuration without exposing its token, and
      disabling it disconnects clients and invalidates the previous credential.
- [ ] On macOS, the copied MCP configuration launches the actual packaged
      PiPilot executable directly in headless stdio mode, never `open -a`; it
      creates no BrowserWindow, Dock/menu/tray presence, or second GUI
      single-instance activation and connects only to the running GUI through a
      current-user private Unix-domain socket.
- [ ] Restarting the macOS GUI rotates the socket and token while the stable
      descriptor locator keeps the copied client configuration reusable. When
      PiPilot is stopped or External Control is disabled, the stdio process
      returns a bounded unavailable error and exits without opening the GUI,
      requesting Keychain access, or creating a TCP listener/firewall prompt.
- [x] The final dependency inventory reports no outdated direct dependency
      except a documented stable Vite fallback selected because the beta lane
      failed a strict gate.
- [x] `docs/README.md` classifies all project-owned current and historical
      documentation; every current authority matches the final source and
      executed evidence, and every historical plan/audit/phase report is
      unmistakably labeled as a dated snapshot.
- [x] `README.md` and `README.zh-CN.md` remain semantically paired, and automated
      drift scans find no obsolete Pi version, former single-Worker ownership,
      stale test count, superseded release status, invalid command/path, or
      future feature stated as already shipped in a current document.

The two macOS native-observation criteria above remain unchecked: the packaged
arm64 tests prove one GUI CDP page, direct headless launch, private UDS
permissions, credential rotation, stopped/disabled failure, and no second GUI,
but do not substitute for an external assertion of Dock/menu/tray visibility,
firewall behavior, or the unexecuted Windows/Linux/macOS x64 native jobs.

## Out of Scope

- Remote Internet exposure or a hosted PiPilot control service.
- Direct access to raw Session JSONL, credentials, environment variables, or
  arbitrary Electron IPC.
- MCP resources/subscriptions, arbitrary transcript/history retrieval, remote
  access, and per-call confirmation dialogs.
- Claiming compatibility for an upstream release before its current-worktree
  parity and packaging gates pass.
- Rewriting archived Trellis tasks, workspace journals, test-fixture Markdown,
  third-party documentation, or historical report evidence to use current
  versions and counts. These remain historical or generated inputs and are
  classified rather than falsified.
