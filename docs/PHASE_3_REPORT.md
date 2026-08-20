# Phase 3 Report - Pi SDK and Agent Utility Process

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 3. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 3 - Real Pi SDK integration in a supervised Electron Agent Utility
Process.

## 2. Completed work

- Verified the current maintained Pi repository, package metadata, installed
  declarations, and SDK implementation before writing integration code.
- Locked `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` to exact
  version 0.84.0. Electron 43's Utility Process Node 24.18.1 satisfies the SDK's
  Node >=22.19.0 requirement.
- Added a second named electron-vite Main entry that emits
  `out/main/agent-worker.js` beside the existing Main entry.
- Added protocol version 1 with strict request, response, error, event, runtime,
  session, model, thinking, and resource schemas.
- Added every required operation name:
  `runtime.start/stop/restart/status`, `session.new/open/list/rename/delete/fork`,
  `session.prompt/steer/followUp/abort/compact`, `model.list/select`,
  `thinking.select`, `resources.reload`, and `event.subscribe`.
- Added UUID request correlation, UUID event identity, runtime generation,
  monotonic event sequence, session ID, and session epoch. Main rejects stale
  generations, repeated/out-of-order sequences, and old-session events.
- Added a real Utility Process host using actual `ModelRuntime`,
  `createAgentSessionServices`/`DefaultResourceLoader`,
  `AgentSessionRuntime`, and persistent `SessionManager` APIs.
- Kept Pi's normal global agent directory as the production resource/auth/model
  source while placing the default PiPilot working directory and JSONL sessions
  below Electron `userData`.
- Loaded extensions, skills, prompts, themes, AGENTS context, package resources,
  and extension-backed MCP through `DefaultResourceLoader`. Individual extension
  failures become bounded diagnostics instead of raw paths or stacks.
- Added compatibility detection for existing `pi-hermes-memory` and
  `pi-observational-memory` package extensions without installing or
  reimplementing either memory system.
- Bound extensions in headless RPC mode and re-bound extension/session event
  handlers after SDK-managed new/open/fork replacement.
- Disabled Pi's built-in read, bash, edit, and write tools until the ordered
  permission phase. This phase does not enable Pi's built-in shell or file
  mutation surface; user-installed extension tools remain part of the user's
  existing Pi extension trust boundary.
- Added normalized streaming, thinking, tool lifecycle, queue, compaction,
  retry, session-name, and thinking-level events. Raw messages, tool results,
  file paths, auth data, headers, and provider URLs are not forwarded.
- Added Main supervision for start, stop, restart, status, ready handshake,
  timeouts, stdout/stderr draining, exit codes, pending-request cancellation,
  failed state, one automatic-restart maximum, and graceful app-quit cleanup.
- Added a narrow validated preload facade under `runtime`, `session`, `model`,
  `thinking`, and `resources`; raw `ipcRenderer` and worker protocol access stay
  hidden.
- Kept deterministic test mode explicitly unpackaged/E2E-only. It still uses a
  real Pi `AgentSession` and Pi event stream, with the official Pi faux provider
  supplying deterministic model responses.
- Preserved the complete frozen Renderer without wiring its mock stores yet.

Authoritative references checked on 2026-08-07:

- [Pi Coding Agent package and source](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
- [Pi SDK documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Electron Utility Process](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron Parent Port](https://www.electronjs.org/docs/latest/api/parent-port)

## 3. Modified files

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `electron.vite.config.ts`
- `src/shared/agent-protocol.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/agent-worker/index.ts`
- `src/main/agent/agent-runtime-supervisor.ts`
- `src/main/ipc/register-agent-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `tests/unit/agent-protocol.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_3_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| package/lock/workspace files | Exact Pi SDK dependencies, reproducible resolution, and explicit lifecycle-script policy |
| `electron.vite.config.ts` | Named Main and Agent Worker build entries with shared chunks |
| `agent-protocol.ts` | Versioned operation contracts, safe view models, envelopes, errors, and normalized event schemas |
| shared IPC/API files | Validated Main/preload contracts and renderer-visible business facade types |
| `agent-worker/index.ts` | Real Pi services/session runtime, persistent sessions, resources, operation dispatch, event normalization, and safe errors |
| `agent-runtime-supervisor.ts` | Utility Process lifecycle, correlation, timeouts, stale filtering, crash isolation, bounded restart, and cleanup |
| `register-agent-ipc.ts` | Trusted-sender business handlers and validated Main-to-preload event publication |
| `src/main/index.ts` | App-owned Agent directories, supervisor construction, IPC registration, and quit-time disposal |
| `src/preload/index.ts` | Narrow invoke wrappers and validated runtime/session event subscriptions |
| unit test | Strict protocol, payload, identity, and unsafe-field regressions |
| Electron test | Real Pi session, streaming, persistence, replacement, Abort, crash isolation, and restart evidence |
| docs | Current process ownership, phase completion, evidence, limitations, and next work |

## 5. Dependencies added and reason

### `@earendil-works/pi-coding-agent@0.84.0`

This is the maintained Pi Coding Agent SDK package and provides the required
real `ModelRuntime`, `DefaultResourceLoader`, `AgentSessionRuntime`,
`SessionManager`, resources, extension binding, and session event APIs. The
repository previously had no Pi SDK or equivalent Agent implementation.

### `@earendil-works/pi-ai@0.84.0`

This is the matching Pi model/runtime package already used transitively by the
Coding Agent. It is a direct dependency only because the official deterministic
`fauxProvider` and `fauxAssistantMessage` test helpers are exported here rather
than from the Coding Agent package. This avoids inventing a fake Agent protocol
while keeping E2E independent from user credentials and remote services.

Both are exact-version, MIT-licensed packages from the same maintained Pi
monorepo. No competing Agent framework, memory library, MCP package, Skill, or
browser binary was installed. No `node_modules` file was edited.

The first dependency install was stopped by pnpm's lifecycle-build approval for
`@google/genai` and `protobufjs`. Their published scripts were inspected: the
former is a no-op preinstall notice and the latter performs a version warning,
not a runtime build. Both are explicitly denied in `allowBuilds`; Electron and
esbuild remain the only allowed builds. Exact current Pi family versions are
listed in `minimumReleaseAgeExclude` so the already-verified coordinated release
can resolve without weakening the policy for unrelated packages. Final offline
install completed successfully. pnpm reports one deprecated transitive package,
`node-domexception@1.0.0`.

## 6. New IPC

| Channel/event group | Preload facade | Result |
| --- | --- | --- |
| `pipilot:agent:runtime-status/start/stop/restart` | `runtime.getStatus/start/stop/restart` | Validated runtime snapshot |
| `pipilot:agent:runtime-changed` | `runtime.subscribe` | UUID event with validated runtime snapshot |
| `pipilot:agent:event` | `session.subscribe` | Normalized, versioned current-session event |
| `pipilot:session:new/list/open/rename/delete/fork` | Matching `session` methods | Opaque session IDs and safe metadata only |
| `pipilot:session:prompt/steer/follow-up/abort/compact` | Matching `session` methods | Current safe session snapshot |
| `pipilot:model:list/select` | `model.list/select` | Non-secret model metadata/current session |
| `pipilot:thinking:select` | `thinking.select` | Current session/thinking snapshot |
| `pipilot:resources:reload` | `resources.reload` | Redacted resource counts and memory status |

There are 19 new validated invoke operations and two validated event channels.
Every Renderer/Main invoke retains the Phase 1 trusted-main-frame check, UUID
correlation, strict request/response/result validation, and structured error
mapping. Renderer cannot provide cwd, agentDir, sessionDir, Worker path, or faux
mode.

## 7. New shared types

- `AgentOperation`
- `AgentRequestPayload<TOperation>`
- `AgentResponsePayload<TOperation>`
- `AgentWorkerReadyMessage`
- `AgentWorkerRequestMessage`
- `AgentWorkerResponseMessage`
- `AgentWorkerEventMessage`
- `AgentWorkerError`
- `AgentRuntimeSnapshot`
- `AgentWorkerState`
- `AgentSessionSnapshot`
- `AgentSessionInfo`
- `AgentModel`
- `AgentResourceSnapshot`
- `AgentEventPayload`
- `ThinkingLevel`
- runtime/session listener types in the preload facade

Session paths remain Worker-private. Model objects omit base URLs, headers,
credentials, compatibility settings, and cost payloads.

## 8. New runtime schemas

- protocol version, operation enum, UUID ready/request/response/event envelopes;
- per-operation strict request and response schemas for all required operations;
- runtime state/failure and worker-state schemas;
- safe model, session snapshot, session-list, thinking-level, resource,
  diagnostic-count, and memory-integration schemas;
- structured Worker error schema with fixed `agent-worker` source;
- normalized agent/session/resource/extension event union;
- runtime-changed and Agent event IPC schemas.

Every Worker event requires positive runtime generation, positive sequence,
session ID, and positive session epoch. Both Worker and Main validate operation
payloads/results; preload validates Main results and events again.

## 9. Tests added

Five protocol unit tests bring the suite to 5 files and 32 tests:

- exact presence of every required protocol operation name;
- versioned UUID request acceptance and unknown-field rejection;
- operation-payload validation and secret-like extra-field rejection;
- mandatory runtime/session identity on events;
- malformed correlation and unsafe response-field rejection.

A second Electron E2E test now proves:

- an isolated Utility Process named `PiPilot Agent Runtime` starts;
- the actual Pi SDK constructs a persistent Agent session;
- Pi's official faux provider is selected only in explicit E2E mode;
- a prompt emits real Pi `text_delta` events and persists JSONL;
- session new and open replace/rebind the real SDK session;
- Abort is sent only after a new slow-response delta and leaves the session idle;
- `SIGKILL` of the Utility Process leaves the BrowserWindow and preload API alive;
- state becomes failed without automatic restart in deterministic test mode;
- manual restart creates a higher runtime generation and can list persisted
  sessions;
- the expanded bridge remains frozen and Renderer remains sandboxed without
  Node globals.

No external model request, user key, memory package installation, or mock
replacement for `AgentSession` is used.

## 10. Verification commands

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm test:electron`
- `pnpm test:visual`
- `pnpm peers check`
- `git diff --check`
- focused trailing-whitespace search
- Git index mode, ignore-rule, and local Skill symlink inspection

## 11. Real result of each command

### TypeScript and unit tests

- The implementation-time type diagnostic found three concrete issues: the SDK
  does not export its internal theme singleton, an unused type import, and
  ES2021-only `replaceAll` under the ES2020 target. The Worker now correctly uses
  the SDK no-op UI context, removes the import, and uses an ES2020 regex.
- Final TypeScript (inside `pnpm build`): passed without diagnostics.
- Final `pnpm test:unit`: 5 files passed, 32 tests passed, 332 ms.

### Build

- Final `pnpm build`: passed.
- Main build: 19 modules; protocol chunk 10.94 kB, Agent Worker 21.75 kB,
  Main index 55.77 kB.
- Preload: 84 modules, 163.48 kB.
- Renderer: unchanged 640 modules; HTML 1.56 kB, CSS 94.87 kB,
  JS 1,907.71 kB.

### Electron integration

- The first managed-sandbox attempt failed both cases before application code
  with macOS `SIGABRT`/`EPERM`; the same command was rerun in the approved GUI
  environment.
- First successful run: 2 passed, 0 failed, 6.7 seconds.
- After strengthening Abort to clear old deltas and await a new slow-response
  delta, the next run passed in 7.3 seconds.
- Final run after exact protocol-name and stop-timeout hardening:
  `pnpm test:electron` passed 2 of 2 in 6.5 seconds.

### Visual regression

- `pnpm test:visual`: 8 passed, 0 failed, 18.3 seconds in the approved desktop
  environment.
- No screenshot baseline was updated. Dark/light idle, running,
  waiting-approval, and Settings remain pixel-compatible with the approved
  references.

### Dependency and repository checks

- `pnpm peers check`: no peer dependency issues.
- `git diff --check`: passed.
- Focused trailing-whitespace search returned no match.
- Git index contains zero mode-120000 entries.
- Local `.agents/skills/*` entries are symlinks and the ignore pattern is
  effective under `git check-ignore --no-index`; their historical tracked-file
  deletions were not staged.
- `.pnpm-store`, `.playwright-mcp`, test results, Playwright report, and blob
  report paths remain ignored.

## 12. UI files modified

None.

No React component, renderer store, locale file, CSS file, theme token,
typography setting, layout, Markdown renderer, ToolCallCard, ApprovalCard,
Inspector panel, or Settings view changed in Phase 3.

## 13. UI modification necessity

No UI modification was necessary. The new functionality is intentionally
available only through typed backend/preload boundaries until Phase 4 replaces
workspace/session fixtures and Phase 5 replaces message fixtures.

本阶段未修改已冻结 UI、主题 Token、字号、间距或组件视觉结构。

## 14. Visual regression result

Passed: 8 of 8 approved macOS references with no baseline update and no
reported differences.

## 15. Mock data still in use

- The visible workspaces, projects, sessions, titles, pins, and actions;
- visible messages, streaming animation, thinking, tools, and approvals;
- files, diffs, terminal, and logs;
- visible models, providers, context usage, resources, and diagnostics;
- General settings controls not covered by Phase 2;
- update/about runtime information.

Electron's backend runtime/session/model/resource facade is now real. Browser
preview and visual tests intentionally keep deterministic renderer fixtures.
Electron E2E uses a real Pi SDK session with only the remote model response
source replaced by Pi's official faux provider.

## 16. Known issues

- No user credential was read or added, so an external provider prompt was not
  sent. Real mode initializes the user's actual `ModelRuntime`; without
  configured auth/model, prompt failure remains a structured recoverable error.
- The visible frozen UI does not consume the new facade yet, by phase order.
- The runtime currently uses one app-owned default cwd. Workspace selection and
  generation replacement arrive in Phase 4.
- Session delete exists at the backend boundary but is not called by the UI;
  Phase 4 must add the required confirmation before exposing that action.
- Built-in mutating tools remain disabled. Permission-gated real tools and
  truthful ToolCallCard/ApprovalCard state are Phase 6.
- Extension UI dialogs are unavailable in headless mode. Extension event
  handlers, commands, resource discovery, and tools load, but extensions that
  explicitly require an interactive dialog see `hasUI=false`.
- Resource reload is not yet transactional with rollback to the previous
  runtime, and only summary counts are exposed. The complete catalog and reload
  fallback belong to Phase 10.
- Memory compatibility is implemented through normal package discovery and
  known-package diagnostics, but neither memory package was installed solely
  for this test. A user's existing compatible package is used as-is.
- Packaging still needs explicit external Pi dependency/Worker inclusion and a
  packaged smoke test in Phase 12.
- The existing remote-font, release minification, fuses, and signing limitations
  from earlier reports remain.

## 17. Next phase plan

Phase 4 will connect workspaces and sessions to the existing Sidebar without
changing its visible structure:

1. add a validated native directory picker and canonical workspace boundary;
2. persist recent projects with name, path, last-opened time, and pin state;
3. recreate the Agent runtime with a new generation on workspace change;
4. expose per-workspace session list/new/open/rename/pin/delete/fork through
   renderer adapters/stores;
5. add deletion and active-run switch confirmation through existing dialogs;
6. reject stale workspace/session events and handle missing paths gracefully;
7. verify restart, workspace isolation, session replacement, Electron E2E, and
   all frozen visual references.
