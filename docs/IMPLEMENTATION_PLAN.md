# PiPilot Implementation Plan (Historical)

This document records the completed Electron + Pi SDK migration. It is not an
active delivery plan and imposes no sequencing, UI, architecture, security,
data, or verification constraints on current development. New work is managed
through `.trellis/tasks/` and `.trellis/spec/`.

> **Historical snapshot (2026-08-08):** This plan preserves an earlier
> implementation sequence and evidence. It is not current product or release
> authority. See [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## Progress

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Audit, UI lock, and engineering baseline | Complete |
| 1 | Electron secure foundation | Complete |
| 2 | Settings persistence | Complete |
| 3 | Pi SDK and Agent Utility Process | Complete |
| 4 | Workspaces and sessions | Complete |
| 5 | Real message stream and Markdown | Complete |
| 6 | Tool lifecycle and permissions | Complete |
| 7 | Files and Diff | Complete |
| 8 | Real terminal | Complete |
| 9 | Models, providers, and keys | Complete |
| 10 | Skills, extensions, MCP, and resources | Complete |
| 11 | Complete test system and CI | Complete |
| 12 | Packaging and distribution | Complete |
| 13 | Release security and stability review | Complete |

## Phase 0 - Audit, UI lock, and engineering baseline

Goal: establish facts, constraints, deterministic references, and a repeatable
renderer build without implementing business functionality.

Deliverables:

- complete repository and component audit;
- explicit Electron, Pi SDK, and mock-data assessment;
- root `AGENTS.md`;
- UI and project constraint documents that were later retired when current
  development moved to Trellis;
- `docs/ARCHITECTURE.md`;
- this implementation plan;
- fixed visual scenarios for dark/light idle, running, waiting approval, and
  settings;
- committed platform-specific baselines;
- comparison-only visual command with failure diff artifacts.

Acceptance:

- current app starts;
- TypeScript passes;
- production renderer build passes;
- all eight visual comparisons pass;
- no source UI file changes are needed for the baseline.

## Phase 1 - Electron secure foundation

Goal: add the desktop shell while producing the same renderer pixels.

Planned work:

- inspect current stable Electron, Vite integration, and packaging options;
- add only the Electron/build dependencies required by the chosen structure;
- add Main and preload entries and development/production loading;
- configure BrowserWindow security flags and strict CSP;
- expose a typed `window.pipilot` business facade without raw ipcRenderer;
- create shared channel, envelope, error, and runtime-validation contracts;
- validate IPC senders and response payloads;
- deny navigation and new windows; allow validated `http:`/`https:` external
  links through Main;
- introduce a controlled production protocol;
- persist and clamp window bounds/maximized state across display changes;
- add security/IPC tests and an Electron launch E2E smoke test.

Acceptance evidence includes renderer Node isolation, rejected invalid IPC,
navigation/popup enforcement, Electron startup, build, and unchanged visuals.
Pi SDK remains absent.

Status: complete. Evidence is recorded in `docs/PHASE_1_REPORT.md`.

## Phase 2 - Settings persistence

Goal: migrate settings authority to Electron Main without changing Settings UI.

Planned work:

- preserve ThemeMode, Locale, Density, AppearanceSettings, and AppSettings;
- add schema version, defaults, deep merge, and migrations;
- implement an atomic SettingsRepository under userData;
- back up corrupt settings and recover defaults with redacted diagnostics;
- add typed/validated get, update, reset, and subscribe APIs;
- introduce SettingsAdapter with LocalStorageSettingsAdapter for explicit web
  mock mode and ElectronSettingsAdapter for desktop;
- debounce writes while keeping UI updates immediate;
- apply initial theme before first paint;
- test repository, migration, corruption recovery, IPC, and restart behavior.

Status: complete. Evidence is recorded in `docs/PHASE_2_REPORT.md`.

## Phase 3 - Pi SDK and Agent Utility Process

Goal: run the installed, version-verified Pi Coding Agent SDK outside Main and
Renderer.

Planned work:

- identify the exact maintained SDK package and verify its installed types and
  authoritative documentation before coding;
- define and test a versioned Main/worker protocol with request/session IDs;
- supervise worker start, stop, restart, status, output, exit, and bounded
  diagnostics;
- initialize ModelRuntime, DefaultResourceLoader, AgentSessionRuntime, and
  SessionManager using actual APIs;
- support runtime/session/model/thinking/resource operations listed in the
  architecture requirements;
- rebind events on session replacement and reject stale events;
- keep full keys outside Renderer;
- isolate crashes and avoid infinite restart;
- preserve explicit mock mode for tests;
- verify compatibility discovery for pi-hermes-memory and
  pi-observational-memory without reimplementing either.

Status: complete. Evidence is recorded in `docs/PHASE_3_REPORT.md`.

## Phase 4 - Workspaces and sessions

Goal: replace Sidebar fixtures with local workspace and Pi session data.

Planned work:

- system folder picker and access validation;
- recent-project repository with name, path, last-opened time, and pin state;
- missing/unavailable path handling;
- runtime generation replacement on workspace switch;
- per-workspace SessionManager listing and new/open/switch/rename/pin/delete/fork;
- confirmation for deletion and switching during active work;
- event subscription replacement and stale-event rejection;
- title/project search using the current Sidebar footprint;
- restart and cross-workspace isolation tests.

Status: complete. Evidence is recorded in `docs/PHASE_4_REPORT.md`.

## Phase 5 - Real message stream and Markdown

Goal: feed real Pi session events into the existing message/tool/approval
components.

Planned work:

- normalized per-session message store for user, text, thinking, tools,
  approval, errors, abort, compaction, and session state;
- batched streaming updates that do not invalidate the whole page per token;
- incomplete Markdown handling with raw HTML disabled and safe URLs only;
- external link handoff to the secure Electron API;
- preserve ToolCallCard, ApprovalCard, DiffViewer, and Terminal boundaries;
- maintain code language, copy, wrap, scroll, line numbers, and collapse;
- bottom-follow behavior that respects manual scroll;
- correct abort/session-switch cleanup and unobtrusive compaction status;
- performance, malformed Markdown, cross-session, theme, and visual tests.

Status: complete. Evidence is recorded in `docs/PHASE_5_REPORT.md`.

## Phase 6 - Tool lifecycle and permissions

Goal: connect actual Pi tool events to truthful execution and approval state.

Planned work:

- inspect the exact installed Pi event/tool API before implementation;
- normalize queued, running, waiting-approval, success, failed, and cancelled
  states by toolCallId and sessionId;
- render true duration, command/path summary, output, and patch data;
- implement PermissionService for read/write/shell/network/destructive scopes;
- implement one-shot, session, workspace, and permanent rules;
- analyze shell risk before execution and narrowly match allowed patterns;
- require second confirmation for persistent rules and avoid broad permanent
  options for high-risk commands;
- enforce authorization outside Renderer and return structured denial;
- cancel approvals on abort and reject wrong-session decisions;
- prove an unapproved shell command cannot execute.

Status: complete. Evidence is recorded in `docs/PHASE_6_REPORT.md`.

## Phase 7 - Files and Diff

Goal: provide a bounded, lazy, truthful view of the active workspace.

Planned work:

- canonical workspace path service with traversal and symlink-escape defense;
- lazy directory expansion with generated/cache ignore defaults;
- refresh and file modification status with Git-absent fallback;
- size-limited text preview and binary rejection;
- actual unified patches, modification navigation, accept, and rollback;
- optimistic conflict guard that refuses to overwrite external changes;
- path, large-tree, preview, diff, and conflict tests;
- no direct renderer filesystem access.

Status: complete. Evidence is recorded in `docs/PHASE_7_REPORT.md`.

## Phase 8 - Real terminal

Goal: connect TerminalPanel to a real manual PTY without conflating it with
Agent shell permissions.

Planned work:

- re-check existing dependencies before selecting xterm/node-pty equivalents;
- create typed create/input/resize/output/exit/kill APIs;
- run PTYs in Main or a dedicated utility process;
- isolate terminals per workspace, cap count, and clean all children;
- choose platform default shells safely;
- reflect mono font, code size, ligatures, and wrapping through existing settings;
- rebuild and package native modules correctly;
- test cwd, resize, lifecycle, workspace switch, and shutdown cleanup.

Status: complete. Evidence is recorded in `docs/PHASE_8_REPORT.md`.

## Phase 9 - Models, providers, and keys

Goal: make model/provider settings real while keeping full credentials in Main.

Planned work:

- load built-in models, models.json, custom providers, and auth state through
  actual Pi ModelRuntime APIs;
- expose validated non-secret model metadata and grouped providers;
- support per-session model and thinking-level changes with rollback on error;
- store keys through safeStorage and expose only configured state/masked suffix;
- add/update/delete/test credentials without logging or session leakage;
- detect Linux weak safeStorage backend and show a localized warning;
- validate contextWindow/maxTokens and clamp requested output to declared model
  limit, remaining context, and application safety cap;
- test malformed metadata, huge-output prevention, secret boundaries, and
  persistence.

Status: complete. Evidence is recorded in `docs/PHASE_9_REPORT.md`.

## Phase 10 - Skills, extensions, MCP, and resources

Goal: expose Pi DefaultResourceLoader discovery and diagnostics without making
one broken resource fatal.

Planned work:

- list skills, extensions, prompt templates, context files, MCP servers, and
  diagnostics with global/project/package/custom source;
- expose enabled/loaded/error state and redacted diagnostics;
- support resource reload with transactional fallback to the prior runtime;
- update project resources after workspace switch;
- surface compatible memory-plugin commands through the Pi resource system;
- classify high-permission MCP capabilities and avoid enabling all by default;
- keep tokens out of project configuration;
- test partial failure, reload rollback, source classification, and workspace
  switching.

Status: complete. Evidence is recorded in `docs/PHASE_10_REPORT.md`.

## Phase 11 - Complete test system and CI

Goal: fill the required unit, integration, Electron E2E, visual, and security
matrix and execute it in CI.

Planned work:

- add Vitest only when core modules exist to test; do not introduce it merely
  for Phase 0 coverage;
- unit-test repositories, migrations, schemas, protocol, reducers, permission
  matching, paths, model limits, workspace/session state, and conflicts;
- integration-test Main/preload, Main/worker, subscription replacement,
  persistence, crash recovery, boundaries, permissions, PTY, and secrets;
- Electron E2E with temporary userData covering the full primary workflow;
- visual states for idle/running/waiting/failed/settings in dark and light;
- security tests for renderer isolation, secrets, invalid IPC/sender/path/URL,
  unapproved shell, and session approval isolation;
- deterministic cleanup of worker and PTY processes;
- CI gates for typecheck, unit, integration, build, Electron E2E, and visual
  regression with no baseline-update command.

Status: complete. Evidence is recorded in `docs/PHASE_11_REPORT.md` and
`docs/TEST_MATRIX.md`.

## Phase 12 - Packaging and distribution

Goal: produce installable artifacts and execute packaged-app smoke tests.

Planned work:

- extend the established packaging approach rather than replacing it;
- configure PiPilot name, productName, appId, version, icons, asar, logs, and
  crash output;
- package worker and Pi resources and exclude tests/secrets/user paths;
- support Windows x64, macOS arm64/x64, and Linux x64 targets;
- package/rebuild native PTY dependencies;
- configure Windows installer, macOS signing/notarization structure, and Linux
  installer targets;
- do not claim signing/notarization without real credentials and results;
- smoke-test startup, worker, settings, themes, workspace, and session creation;
- defer auto-update completion until signing and publishing are stable.

Status: complete. Evidence is recorded in `docs/PHASE_12_REPORT.md` and
`docs/PACKAGING.md`.

## Phase 13 - Release security and stability review

Goal: audit the complete packaged system, fix every Blocker/High finding, and
state release readiness only from evidence.

Review areas:

- Electron window, CSP, navigation, protocol, external links, and IPC sender;
- IPC schemas, results, privilege, errors, naming, and session isolation;
- filesystem traversal, symlinks, boundaries, races, conflicts, size, binary;
- shell approvals, permanent rule scope, cwd, risk, cleanup, abort;
- key leakage and safeStorage backend;
- worker crashes, event isolation, abort, leaks, restart, resource failures;
- model metadata, provider fields, context/output limits, and fallback;
- UI state truth, accessibility, theme consistency, and no visual redesign.

Findings are reported as Blocker, High, Medium, or Low. Blocker and High are
fixed and reverified. Medium/Low receive actionable recommendations. Release
readiness requires real full-suite and packaged smoke evidence.

Status: complete. Evidence, fixed findings, residual risks, and the public
distribution hold are recorded in `docs/PHASE_13_REPORT.md`. The final 38-item
acceptance mapping is recorded in `docs/COMPLETION_AUDIT.md`.
