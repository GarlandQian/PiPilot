# Complete The Local Pi Developer Workflow

## Goal

Make PiPilot a complete desktop UI for the user's locally installed official Pi
CLI and its optional ecosystem, while finishing the requested sidebar, cost,
icons, terminal, read-only Diff, Composer, and MCP configuration workflows.

## Confirmed Product Boundary

- The local Pi executable is the only mandatory external installation. Every
  non-MCP workflow must work with Pi alone and no extension/plugin.
- PiPilot is Electron-only. React/Vite is the internal desktop renderer, not a
  standalone web product; no production Store/component may fall back to static
  browser data when preload/Main is absent.
- PiPilot launches the selected executable as `pi --mode rpc --approve` in the
  active conversation cwd. A project cwd is only a folder explicitly selected
  by the user; projectless uses `userData/general-chat/workspace`. The official
  `--approve` flag loads resources for that run; PiPilot has no separate
  approval/safety policy.
- The selected local Pi owns Agent behavior, models, tools, credentials,
  sessions, settings, packages, extensions, skills, prompts, providers, and
  optional MCP execution.
- PiPilot does not bundle/fallback to Pi SDK, PiServer/client, private upstream
  paths, copied RPC clients, or its old Worker.
- Every Agent-facing capability must map to the latest documented Pi
  CLI/RPC/resource contract. Custom code survives only for process/Electron/UI/
  filesystem integration that Pi does not expose; otherwise it is deleted.
- Planning target is Pi `0.84.1`, latest verified on 2026-08-09; implementation
  rechecks latest and reports the actual selected path/version. PiPilot never
  installs or updates global Pi automatically.
- Official RPC-supported rename, fork/clone, entries/tree inspection,
  compaction, follow-up/modes, images, commands, stats, automatic-retry controls,
  and extension UI stay available.
- Session delete/pin, credential/resource management, custom approvals/model
  safety, MCP risk review, sensitive-file/environment policy, and Diff mutation
  are removed.
- Baseline correctness remains: RPC correlation/generation guards, atomic
  surviving app/config writes, canonical workspace containment, bounded reads,
  and bounded current-format session catalog access.
- PiPilot never passes `--session-dir`. Local Pi owns the session root and cwd
  organization; Main learns actual catalog directories from
  `get_state.sessionFile` after scope activation.
- General UI icons use Tabler; file/folder decorations use Material Icon Theme;
  renderer and Electron branding use the same canonical PiPilot `pi` mark.
- Machine-local symlinks under `.agents/skills/` and dependency-asset symlinks
  are not committed. Unrelated dirty-worktree changes are preserved.

## Requirements

### Local Official Pi And Plugins

- Provide explicit executable selection plus host discovery for desktop launches
  without shell PATH. Show canonical path, version, ready/missing/incompatible/
  crashed status, bounded stderr diagnostics, and retry.
- Use strict documented UTF-8 LF JSONL, request IDs, official snapshots/events/
  extension UI, owned process lifecycle, workspace/session replacement, and
  clean shutdown.
- Load global/project packages/extensions/skills/prompts through the selected Pi
  startup. External package changes apply through controlled process restart and
  official snapshot/command refresh; there is no PiPilot package catalog.
- Preserve PiPilot's independent workspace, file tree/context, terminal,
  read-only Diff, settings, navigation, appearance, localization, and desktop
  lifecycle features.

### Official Capability And Code Cutover

- Restore every documented RPC action listed in the migration child and render
  supported extension dialogs/fire-and-forget surfaces with exact correlation.
- Keep the Composer editable while Pi is running. Idle submission uses
  `prompt`; the running primary action always queues through `follow_up`; an
  explicit split-menu action applies `steer` once without changing that default;
  and Stop remains a separate `abort` command. Project official
  `queue_update` details, `get_state.pendingMessageCount`, and the official
  one-at-a-time/all queue modes without persisting or inventing queue items.
- Keep one generation-scoped renderer view derived from official state/messages/
  events; no durable parallel transcript or Agent state machine.
- Populate the model picker only from official configured models, select through
  `set_model`, and remove all mock/credential-gated model fallbacks. Keep the
  searchable model surface viewport-bounded with only its results region
  scrolling for large provider catalogs.
- Build a bounded read-only current-format official-session catalog from
  directories observed through local Pi; never copy, convert, or relocate
  sessions.
- Delete credential/permission/resource ownership from source, then remove the
  embedded Agent/policy/repository/build/dependency stack. Add no startup data
  cleanup or old-schema compatibility path.

### Electron-Only And Real Settings

- Require the typed Electron preload bridge before mounting application
  providers. A direct browser load shows only an unsupported-environment state;
  it does not enter a reduced or mocked PiPilot mode.
- Remove standalone `dev:web`/`build:web`, production `src/data/mock` imports,
  `'web'` Store/adapter branches, the localStorage Settings authority, and
  browser-server visual tests. Keep Electron Chromium storage and
  Electron/Playwright internals that do not constitute a web product.
- Final Settings navigation is General, Appearance, Language, Models, Terminal,
  MCP, and About. Remove Permissions, Agent Resources, Updates, disabled
  notification/sound/usage placeholders, browser-preview copy, and all other
  unimplemented fixture surfaces.
- General shows the actual selected/discovered Pi path, probe state/version,
  bounded diagnostic, and choose/clear/retry actions from Main. Models/thinking
  use official RPC only. Appearance/language/terminal use Main-owned current app
  settings; MCP uses its standard files/official command detection; About uses
  actual Electron app/platform data.
- Loading, empty, missing, incompatible, and error states must be truthful. Test
  fixtures live only under tests and exercise Electron through preload/Main.

### Sidebar And Header

- Move the left sidebar expand/collapse button into a stable leading ChatHeader
  slot that mirrors the right inspector button in size, alignment, icon family,
  accessibility, and both open/closed states.
- Show official active-session USD cost and context usage from
  `get_session_stats`, refresh at authoritative lifecycle boundaries, and never
  estimate from visible turns.

### Icons And Brand

- Install the latest compatible `material-icon-theme` with pnpm and resolve
  maintained filename/extension/folder/open-folder assets with generic fallbacks.
- Keep Tabler for commands/navigation/status and PiPilot `pi` for brand/package
  icons. Use regular generated assets and verify development/package resolution.

### Terminal Typography

- Replace Terminal Settings placeholder with dedicated custom local font family
  and size controls plus Latin/Chinese preview.
- Add the terminal object directly to the single current settings schema, append
  common cross-platform CJK fallbacks, and apply/refit the existing xterm live
  without replacing the PTY.

### Read-Only Diff

- Install the latest compatible `@pierre/diffs`, use its public React renderer
  in a lazy chunk, and preserve read-only file navigation/status/theme/wrap/
  line-number/error states.
- Delete accept/revert UI and the entire shared/IPC/Main/service mutation,
  fingerprint, and confirmation chain while retaining bounded canonical Git
  status/Diff reads.

### Composer Images And Context

- Implement paperclip chooser/paste/drop for bounded supported images and send
  exact official image objects through prompt, steer, and follow-up.
- Implement a keyboard-searchable bounded active-workspace file/directory picker
  for `@`; add deduplicated chips and append canonical path references to the
  message without inlining contents or adding a private RPC field.
- Clear selections only after official acceptance; retain them on conversion,
  connection, timeout, model, or Pi errors. Persist no raw image bytes.

### Optional MCP Disclosure And Configuration

- Keep MCP Settings always visible. Detect `pi-mcp-adapter` only through official
  `get_commands`, never package scans/imports.
- When absent, clearly state that only MCP requires the optional adapter and all
  other features work with Pi; show `pi install npm:pi-mcp-adapter`, copy, and
  refresh/restart detection.
- Do not auto-install/update/remove the adapter and do not show a global startup
  warning to users who do not use MCP.
- When detected, edit only project `.mcp.json` and global
  `~/.pi/agent/mcp.json` with structured stdio/HTTP/socket forms plus raw JSONC
  preserving comments/unknown fields. Apply by controlled Pi restart.
- Route TUI-only MCP panel commands to Settings; keep RPC-compatible argument-bearing
  plugin commands official. PiPilot does not execute MCP, handle auth/tokens,
  synthesize live server status, scan risk, or approve tools.

## Acceptance Criteria

- [ ] PiPilot configures/discovers, probes, displays, and controls the selected
      local Pi; missing/incompatible/crashed state is recoverable and never
      falls back to an embedded runtime.
- [ ] With only Pi installed and no optional plugin, chat, sessions, every
      retained RPC action, files/context, terminal, read-only Diff, images,
      settings, icons, and other non-MCP workflows work.
- [ ] Global/project fixture extensions expose commands/tools and supported UI;
      process restart refreshes them and TUI-only UI is accurately degraded.
- [ ] Rename, fork/clone, entries/tree inspection, compact/automatic-retry
      controls, follow-up/modes, images, commands, stats, and extension UI work
      through documented RPC.
- [ ] During generation the Composer defaults every submission to Queue, exposes
      one-shot Steer and separate Stop, displays only official pending queue
      details/counts and modes, routes extension-source commands immediately as
      `prompt`, and clears the captured draft/images/context only after command
      acceptance.
- [ ] The compact searchable model picker shows only real models reported by the
      selected Pi, switches through one official `set_model` command, refreshes
      thinking levels, remains bounded for long catalogs, and never falls back to
      browser/demo mock data.
- [ ] PiPilot has no standalone browser runtime, web build/dev scripts,
      production mock-data imports, web-mode Stores/adapters, or browser visual
      server; Electron visual coverage exercises the real preload/Main path.
- [ ] Every visible Settings value/control has its declared real source. The
      disabled placeholder sections and permission/resource/update/credential
      surfaces are absent, and an unavailable source is never replaced by sample
      data or a hard-coded Pi runtime version.
- [ ] The embedded Worker/SDK/protocol/reducer, credential/permission/resource/
      risk policies, unsupported session actions, sensitive path/env policy, and
      Diff mutation/fingerprints are absent; baseline correctness remains.
- [ ] The repository-wide official-first audit accounts for every old
      Agent/preload/Store operation as official Pi, justified desktop glue, or
      removal; no unclassified custom Agent behavior remains.
- [ ] PiPilot neither recognizes nor mutates old PiPilot session/credential/
      permission/resource data; current sessions stay under Pi's own effective
      session storage with no `--session-dir` override.
- [ ] Left/right panel toggles, official cost/context, Material file icons,
      canonical Pi brand assets, terminal custom font/CJK, lazy read-only Diff,
      and Composer images/context satisfy their child acceptance criteria.
- [ ] MCP Settings is always discoverable; absent adapter disclosure explains
      the optional dependency, provides copy/refresh, leaves all other features
      usable, and never auto-installs or globally nags.
- [ ] With the latest compatible adapter installed, project/global JSONC edits
      save atomically, preserve unknown/commented data, detect external changes,
      restart local Pi, and expose a deterministic MCP fixture through the plugin
      without PiPilot becoming an MCP client.
- [ ] Current dependency versions/purposes and lockfile are recorded; no local
      skill/dependency symlink or unrelated user change is staged.
- [ ] Focused/full unit, integration, Electron, affected visual, typecheck,
      production build, directory package, real no-model local Pi, and packaged
      explicit-path checks pass; skipped checks are reported as not run.

## Out Of Scope

- Bundling, downloading, auto-updating, or forking Pi; managing Pi packages from
  a second package manager.
- Private Pi imports/copied client code or a second Agent semantic runtime.
- A standalone website/browser-preview product or feature parity without
  Electron Main/preload.
- In-place TUI tree-node navigation or manual last-response retry until official
  RPC exposes corresponding commands.
- Session delete/pin, credential/resource management, approvals/safety/risk
  policy, old-data migration/cleanup, or TUI-only custom component emulation.
- Arbitrary Composer binary/text attachments, external context files, automatic
  content injection, or persistent attachment storage.
- Diff mutation/review annotations, user-selectable Diff engines/icon themes, or
  a complete Git client.
- MCP without an installed adapter, adapter installation, MCP runtime/auth/token
  storage, host-specific config import, or private adapter UI reproduction.
- Font downloads/embedding, release publishing, signing, or notarization.

## Child Tasks And Dependencies

1. `08-08-official-pi-agent-migration` owns the nested local-RPC cutover and final
   embedded-stack removal/verification.
2. `08-08-sidebar-toggle-position` is independent after layout context loads.
3. `08-08-material-file-tree-icons` is independent and supplies icons later used
   by context search.
4. `08-08-terminal-font-settings` is independent but coordinates shared settings
   files with executable and MCP settings work.
5. `08-08-readonly-diff-viewer` is independent initially and completes before
   embedded-stack cleanup; Composer follows its WorkspaceContentService changes.
6. `08-08-pi-session-cost` follows the renderer stats contract.
7. `08-08-composer-files-context` follows renderer image contracts and the Diff
   service simplification.
8. `08-08-mcp-config-integration` follows command/status/restart contracts and
   coordinates the final Settings layout.
9. `08-08-projectless-chats` follows runtime/catalog scope contracts and supplies
   the no-project cwd/navigation behavior consumed by the sidebar and terminal.

## Risks And Deferred Items

- The current selected Pi/adapter are one patch behind planning latest and may
  require explicit external updates before final smoke tests.
- Finder/desktop launches may lack fnm PATH; packaged explicit-path verification
  is mandatory.
- Future Pi/plugin/library versions may change public contracts. Recheck and
  inspect installed types at implementation instead of relying on planning
  memory.
- Material icons, Shiki-backed Diff, and MCP JSONC add bundle/assets; keep file
  assets bounded and Diff lazy.
- TUI-only plugin UIs remain upstream-degraded until official RPC exposes them.
