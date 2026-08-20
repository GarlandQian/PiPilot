# Implementation Plan

> **Current implementation note (2026-08-22):** The Vite 8 lane passed and is
> retained at electron-vite `6.0.0-beta.1`, Vite `8.2.2`, and
> `@vitejs/plugin-react@6.1.0`. The Vite 7 text below records the fallback that
> would have applied only if the beta lane failed its strict gate.

## Execution strategy

Complete related edits within each phase before testing that phase. Preserve
unrelated worktree changes. Do not publish, weaken tests, or silently change Pi
package ownership. Each dependency family and the MCP bridge have an explicit
rollback point before the combined gate.

## Phase 0 — Re-resolve baseline and establish gates

- [ ] Re-run authoritative direct dependency and Pi package version resolution;
      update `research/dependency-inventory.md` if registry latest changed.
- [ ] Capture current full unit, integration, Electron, build, package, and
      packaged-smoke baseline before dependency edits.
- [ ] Inspect current public types/changelogs/source for every changed Electron,
      Pi, Tiptap, Vite, MCP, and exact package-adapter API.
- [ ] Record all current direct dependencies and map each later change to one
      migration lane.
- [ ] Inventory every project-owned Markdown document and update
      `research/documentation-current-state-audit.md` with its authority class,
      known drift, final owner, and required action. Exclude generated output,
      third-party packages, machine-local Skills, fixtures, journals, and
      archived task evidence from current-product claims.

Rollback: no source change; stop if a relevant baseline is already red and
diagnose it before attributing failures to upgrades.

## Phase 1 — Upgrade dependency lanes independently

### 1.1 Patch application and tooling

- [ ] Upgrade Electron, Vitest, `react-resizable-panels`, `@types/node`, and any
      other newly reported direct patch/minor dependency.
- [ ] Re-run type, focused UI/runtime, Electron startup, Utility Process, and
      build checks before combining with another lane.

### 1.2 Tiptap family

- [ ] Upgrade the complete Tiptap family to one exact release line.
- [ ] Verify Composer typed `@`, `/` Commands/Skills, IME/229, clipboard,
      attachments, scope reset, queue/steer, and accessibility identity paths.

### 1.3 Pi ecosystem

- [ ] Keep `@earendil-works/pi-coding-agent` at the newly resolved registry
      latest and update Host protocol/version assertions only when it changed.
- [ ] Validate `pi-mcp-adapter` through the existing automatic managed path.
- [ ] Validate latest `pi-subagents` while keeping it user-managed.
- [ ] Update exact Plan and Goal adapter gates only after inspecting and testing
      their latest public command/status/widget/entry surfaces.
- [ ] Update fixtures, compatibility summaries, docs, and adapter tests without
      silently installing Subagents, Plan, or Goal.

### 1.4 Vite guarded migration

- [ ] Try `electron-vite@6.0.0-beta.1`, latest Vite 8, and latest
      `@vitejs/plugin-react@6` as one lockstep lane.
- [ ] Run the complete strict gate, including package and packaged smoke.
- [ ] If any unresolved lane-caused gate fails, revert all three packages to
      the latest stable-compatible electron-vite 5/Vite 7/plugin-react 5 set,
      record the exact upstream blocker, and rerun the gate. Do not keep a
      partially mixed family.

### 1.5 MCP SDK

- [ ] Add the latest official `@modelcontextprotocol/server` direct production
      dependency and use only its public server and `./stdio` exports.
- [ ] Confirm its Node/ESM/packaging requirements against Electron Main and all
      supported package targets.

Rollback after each subsection: restore that complete dependency family and
lockfile delta, then prove the previous lane remains green.

## Phase 2 — Shared MCP and bridge contracts

- [ ] Add strict shared Zod schemas/types for bridge descriptor, handshake,
      framed request/response, MCP tools, conversation/status rows, operations,
      stable errors, settings snapshots, and audit rows.
- [ ] Centralize page/frame/prompt/result/idempotency/operation/wait/client bounds.
- [ ] Add iterative plain-DTO/byte validation before socket writes and MCP tool
      results; reject unknown keys and raw recursive values.
- [ ] Add stable request fingerprints for mutating-tool idempotency.
- [ ] Cover every schema, bound, enum, malformed frame, and sanitized error in
      unit tests before implementing process owners.

Rollback: shared modules are additive and have no runtime side effects.

## Phase 3 — Bootstrap, local bridge, and stdio process

- [ ] Split Main into a minimal bootstrap plus dynamically imported GUI Main and
      `--pipilot-mcp-stdio` entry. Parse headless mode before single-instance
      lock or BrowserWindow/tray initialization.
- [ ] Add platform-aware stable packaged command resolution, including validated
      `APPIMAGE` handling and fail-closed unpackaged behavior.
- [ ] On macOS, generate the copied command from the actual packaged
      `process.execPath`; never use `open -a`, a hardcoded `/Applications` path,
      a username, or an inner-ASAR script. Parse headless mode before GUI imports
      and the single-instance lock, apply prohibited/headless activation, and
      prove the branch creates no window, menu, tray, Dock presence, Renderer,
      or Runtime pool.
- [ ] Add atomic current-user-only installation identity and descriptor
      repositories; keep identity and bridge credentials separate.
- [ ] Implement `ConversationMcpBridgeServer` with random per-instance endpoint,
      token handshake, protocol/app-instance negotiation, length-prefixed
      frames, constant-time authentication, client/in-flight/deadline bounds,
      and deterministic close.
- [ ] Implement macOS/Linux UDS permissions and Windows named-pipe isolation.
- [ ] Implement the official MCP stdio server and six tool registrations. Keep
      stdout protocol-only and send diagnostics to stderr/private logging.
- [ ] Join bridge/stdio cleanup to application shutdown without changing normal
      tray-resident GUI behavior.

Rollback: restore the original Main entry and package `main` field; remove the
additive bridge/stdio entries and descriptor state. No Session files are touched.

## Phase 4 — Stable conversation inventory

- [ ] Add Main-only catalog control-target enumeration/revalidation that reuses
      official catalog caches and never exposes paths or selection tokens.
- [ ] Derive stable opaque conversation IDs with the installation identity key.
- [ ] Merge projectless/saved workspace catalog rows with existing Runtime
      summaries into paginated public lifecycle DTOs.
- [ ] Add opaque revision-bound cursors and truthful `not_loaded` scope
      diagnostics.
- [ ] Prove list/status paths do not start Hosts/Runtimes, consume catalog
      tokens, or alter selected Renderer state.
- [ ] Cover copied/moved Session identity, stale cursor, missing scope,
      inactive/runtime reconciliation, large catalogs, and privacy projection.

Rollback: remove the additive Main control view/identity projection; desktop
catalog behavior remains unchanged.

## Phase 5 — Background Runtime control

- [ ] Extend `PiRuntimeFrontend`/its owned Runtime registry with exact
      background acquire/reuse handles; do not add a second Runtime cache.
- [ ] Bind/hydrate inactive catalog targets inside their existing project Host
      without selecting them in Renderer.
- [ ] Route commands by exact scope, Session, Host epoch, Runtime ID, and
      generation; reject stale handles before mutation.
- [ ] Add Main-only all-Runtime observation before the existing single Host
      event acknowledgement.
- [ ] Preserve idle-only LRU and pin every busy/unpersisted Runtime.
- [ ] Cancel blocking extension UI for background MCP work as
      `interaction_required` without showing unrelated desktop UI.
- [ ] Cover same-project and cross-project concurrency, startup failure,
      generation replacement, Host crash, LRU, event-credit, and no-selection
      behavior.

Rollback: remove background acquire/listener methods; selected desktop Runtime
ownership and existing Host pool remain the only consumers.

## Phase 6 — Submission, operation ledger, and tools

- [ ] Add a Host-internal atomic external-submit command for
      `auto|prompt|follow_up|steer` in the shared per-Runtime command lane.
- [ ] Make `send_prompt` atomically reserve idempotency and return
      `received + operationId` before target revalidation, Runtime startup, or
      SDK acceptance; do not include or guess `acceptedMode` at receipt.
- [ ] Project `received -> starting? -> accepting -> accepted -> terminal`
      transitions, including truthful pre-acceptance failure/replacement.
- [ ] Prove Prompt acceptance at `preflightResult(true)` and Follow-up/Steer at
      the public SDK resolution boundary. Reject invalid state without creating
      an accepted state.
- [ ] Add bounded in-memory operation/idempotency registry and metadata-only
      rotating audit repository.
- [ ] Attribute Prompt/Follow-up/Steer completion to exact accepted anchors and
      settled generation boundaries; discard private matching text immediately.
- [ ] Add immediate-receipt exact abort operations, authoritative SDK
      acceptance, and generation-safe completion.
- [ ] Implement list/status/send/abort/get/wait Main handlers and connect them to
      stdio MCP tools through the authenticated bridge.
- [ ] Support `wait_for_turn(until=accepted|terminal)`; ensure wait timeout is
      non-terminal and disconnect removes waits without aborting received or
      accepted work.
- [ ] Cover identical/different idempotency replay, immediate receipt before
      delayed cold startup, pre-acceptance failure, queue ordering, simultaneous
      desktop/MCP send, mixed Runtime concurrency, ambiguous attribution,
      replacement, crash, abort, both wait milestones, client disconnect, and
      bounded final response.

Rollback: remove external-submit and operation services. Existing Renderer
Prompt/Follow-up/Steer/Abort commands remain unchanged.

## Phase 7 — IPC, store, and Integrations UI

- [x] Add strict Main/preload/Renderer settings contracts for enable/disable,
      snapshot, copyable configuration, client count, and metadata-only recent
      operations. Do not expose token, canonical target, or operation content.
- [x] Add `external-control` to the existing controlled Integrations tab state.
- [x] Build the compact External Control page using current primitives/tokens,
      existing Integrations layout, Tabler icons, and bilingual locales.
- [x] Implement explicit disabled/enabling/ready/disabling/error/unavailable
      states, inline errors, Copy, and active-client disable confirmation.
- [x] Reset stale async state by operation/generation; no prior snapshot may
      flash after disable/re-enable or app-instance replacement.
- [x] Verify light/dark, reduced motion, keyboard/focus/ARIA, bilingual copy,
      and 1100x680 no-horizontal-overflow behavior in real Electron.

Rollback: remove the additive tab/contracts and leave External Control disabled;
outbound MCP Settings remain untouched.

## Phase 8 — Security, parity, packaging, and native gates

- [x] Unit-test descriptor/identity permissions, token rotation, protocol/auth
      rejection, constant-time comparison, request limits, cleanup, audit
      privacy, and stdout cleanliness.
- [x] Integration-test stdio SDK discovery and all six tools against a real Main
      bridge using isolated workspace/catalog/SDK fixtures.
- [ ] Electron-test inactive background send, idle send, running auto Follow-up,
      explicit Steer/Abort, wait timeout, final response, UI selection stability,
      enable/disable, connected clients, and Runtime replacement.
- [ ] Package and smoke the actual stdio executable path on macOS arm64/x64,
      Windows x64, and Linux x64 (deb and AppImage where supported).
- [ ] On a packaged macOS arm64 `.app`, launch the exact copied stdio command and
      prove stdout protocol purity, private UDS connection, no BrowserWindow,
      Dock/menu/tray or GUI second-instance signal, bounded failure when the GUI
      is stopped/disabled, stable descriptor reuse after GUI restart, token/
      endpoint rotation, multiple clients within bounds, and no TCP listener,
      firewall, Keychain, or `safeStorage` prompt.
      Current 2026-08-22 evidence covers the copied command, protocol-only
      stdout, private UDS permissions, one GUI page, disabled/stopped failure,
      stable config across real GUI restart, and token/endpoint/instance
      rotation; the remaining native-observation clauses keep this item open.
- [ ] Prove UDS directory/socket permissions and native Windows cross-user named
      pipe denial; fail closed on any platform without proof.
- [ ] Test Codex/Claude Code/MCP Inspector configurations against the packaged
      application and verify stable tool schemas/typed results.
- [x] Verify no prompt/response content, raw Session data, token, path, tool
      argument, credential, or internal stack appears in Renderer snapshots,
      copied config, audit, stdout logs, or MCP read tools.

## Phase 9 — Combined quality and documentation gate

- [x] Re-run registry inventory; document only an approved Vite stable fallback.
- [x] Run the full same-worktree commands below after all edits stop.
- [x] Create `docs/README.md` as the authority index for current versus
      historical documentation.
- [x] Rewrite `README.md`, `README.zh-CN.md`, `PRODUCT.md`, and
      `docs/ARCHITECTURE.md` from final source/config/evidence. Keep both READMEs
      semantically paired and distinguish outbound Pi MCP configuration from
      inbound PiPilot External Control.
- [x] Regenerate `docs/TEST_MATRIX.md` from current test files, package scripts,
      CI/release jobs, and commands that actually ran. Remove obsolete counts,
      former process names, and unexecuted platform claims.
- [x] Update `docs/PACKAGING.md` with the final dependency/package boundary,
      exact native targets, signing/manual-update policy, headless stdio entry,
      macOS UDS behavior, AppImage resolution, and only verified release facts.
- [x] Update every affected backend/frontend spec for embedded Pi, Host/Runtime,
      catalog, local bridge, operation, External Control state/UI, packaging,
      and verification ownership. Update a reusable guide only when this task
      establishes a general cross-layer rule.
- [x] Add the standard historical-snapshot notice and current-authority links to
      `docs/IMPLEMENTATION_PLAN.md`, `docs/COMPLETION_AUDIT.md`, and all
      `docs/PHASE_*_REPORT.md` without rewriting their original dates, versions,
      counts, findings, or evidence.
- [x] Run link, heading, bilingual README, path/command, version, and targeted
      stale-claim audits. Historical hits are permitted only behind the explicit
      snapshot notice; current-authority drift is a release blocker.
- [x] Run Trellis check, resolve every verified finding, and rerun affected/full
      gates. Do not publish until the user reviews the evidence.

Final local reviewer evidence on 2026-08-22: `pnpm outdated --json` returned
`{}`; the frozen install, peer check, zero-vulnerability audit, typecheck,
production build, 81-file/618-test unit suite, 2-test integration suite,
14-test Electron suite, macOS arm64 directory package, 2-test packaged suite,
documentation drift scans, and `git diff --check` passed. Native Windows x64,
Linux x64, macOS x64, installer, cross-user named-pipe, and native Dock/menu/
tray observation remain release-runner limits and are not claimed.

## Validation commands

Exact focused filenames may grow during implementation; do not replace the
full gates with focused-only evidence.

```bash
# Registry and lockfile
pnpm outdated --json
pnpm install --frozen-lockfile
pnpm list --depth 0

# Focused contracts/services/UI (add actual new test files)
pnpm exec vitest run \
  tests/unit/ipc-contracts.test.ts \
  tests/unit/official-pi-session-catalog.test.ts \
  tests/unit/pi-runtime-frontend.test.ts \
  tests/unit/i18n.test.ts

# Full project gates
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm build
pnpm package:dir
pnpm test:packaged
git diff --check

# Documentation authority and drift
rg -n "0\\.84\\.0|Agent Utility Process|single active runtime|not a public release|publishing and auto-update are intentionally unavailable" \
  README.md README.zh-CN.md PRODUCT.md docs/ARCHITECTURE.md docs/PACKAGING.md docs/TEST_MATRIX.md .trellis/spec
rg -n "open -a|127\\.0\\.0\\.1|localhost|Keychain|safeStorage" \
  README.md README.zh-CN.md PRODUCT.md docs/ARCHITECTURE.md docs/PACKAGING.md .trellis/spec
```

Native CI/package jobs must run on macOS arm64/x64, Windows x64, and Linux x64.
The final report distinguishes a test that actually ran from a static claim or
an unavailable platform.

## Review gate before implementation

- [x] PRD, design, implementation plan, and all research notes have no open
      product questions or contradictory ownership rules.
- [x] `implement.jsonl` and `check.jsonl` contain only real spec/research paths
      and validate.
- [ ] The user approves this completed plan in a subsequent message.
- [ ] Only then run `task.py start` and dispatch the configured Trellis
      implementation agent.
