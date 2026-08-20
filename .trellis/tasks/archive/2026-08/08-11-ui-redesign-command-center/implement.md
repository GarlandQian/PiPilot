# Implement — Command Center UI Redesign

Direct implementation by the main agent (inline; no sub-agent dispatch).
Worktree is dirty with unrelated user changes — never `git add -A`, never
touch files outside this plan. No commits until the user's verification
round (Phase 3.4 waits).

Spec references: `.trellis/spec/frontend/component-guidelines.md`,
`directory-structure.md`, `state-management.md`, `type-safety.md`.

## Phase A — Tokens and primitives

- [ ] A1. `src/styles/globals.css`: recalibrate neutral + sage scales
      (light-mode sage one step darker for AA), add `--radius-sm/md/lg`
      (keep `--radius` as md alias), `--duration-fast/base`,
      `--ease-standard`, `focus-ring` utility. Keep every existing
      variable name.
- [ ] A2. Restyle `src/components/ui/*` in place (button, badge, input,
      textarea, select, tabs, dialog, alert-dialog, dropdown-menu,
      tooltip, scroll-area, switch, radio-group, checkbox, command, kbd,
      progress, separator, card, collapsible, popover, avatar,
      resizable). Add badge soft variants
      (`soft-success|soft-warning|soft-danger|soft-info`) and migrate
      ToolCallCard/ChatHeader ad-hoc soft badges to them.
- [ ] A3. Add `src/components/ui/form.tsx`: `FormDialog` (760px),
      `FormRow`, `DynamicRows`, `KeyValueRows`.
- Validate: `pnpm typecheck`.

## Phase B — Application frame

- [ ] B1. `src/components/frame/ActivityRail.tsx` (logo, 3 destinations,
      palette button + ⌘K hint, panel toggle; tooltips, aria-labels,
      active indicator).
- [ ] B2. `src/components/frame/ContextPanel.tsx` + sessions body moved
      from `Sidebar.tsx` (workspace section, projects, SessionList with
      project group headers; `expandedProjects`/`projectSessionLimits`
      state moves into the panel).
- [ ] B3. `src/components/frame/StatusBar.tsx` wired to `usePiRuntime`,
      `pi.models`, `useWorkspaceStore` branch, session `contextUsage`,
      `useMcpStore().adapterStatus`.
- [ ] B4. `App.tsx` restructure: `FrameNav` state replaces `view`;
      settings/integrations render as main surfaces; chat stays mounted
      (`hidden`); keyboard map per design §7 (⌘1/2/3, ⌘B/J/K; remove
      Ctrl+.); ChatHeader slimmed to title + session actions (branch /
      model / context / status badges move to StatusBar).
- [ ] B5. `SettingsLayout.tsx`: drop left nav column; nav renders in
      ContextPanel; content column keeps sections.
- Validate: `pnpm typecheck`. **Review gate: frame navigation works by
  mouse and keyboard before restyle continues.**

## Phase C — Command palette

- [ ] C1. `src/lib/commands.ts` registry (static actions + dynamic
      session entries) with a small context object passed from App.
- [ ] C2. `src/components/frame/CommandPalette.tsx` (Dialog + ui/command;
      grouped Actions/Sessions/Settings; reduced-motion aware; focus
      restore).
- [ ] C3. i18n: `rail.*`, `palette.*`, `statusbar.*` keys in both
      catalogs.
- Validate: `pnpm typecheck`; locale parity script (compare key sets).

## Phase D — Surface restyle

- [ ] D1. Sessions panel rows (status-aware, grouped headers, density
      hooks).
- [ ] D2. Chat: MessageList, UserMessage/AgentMessage, ToolCallCard,
      ApprovalCard, Composer, markdown/code blocks adopt new tokens;
      streaming and scroll behavior untouched.
- [ ] D3. Inspector: tabs bar, FileTree, DiffViewer, Terminal/Logs
      restyle; resize handle kept.
- [ ] D4. Settings sections: apply FormRow rhythm/density (no content
      model changes); Appearance previews updated to new neutrals.
- Validate: `pnpm typecheck`.

## Phase E — MCP unified form + Form/JSON single draft

- [ ] E1. Draft-text flow in `useMcpConfig` consumption: single
      `draftText` source; form edits via `applyServerEdits(draftText, …)`;
      JSON edits set draft directly; `structuredSupported` gates the Form
      side; replace `setStructuredServers` usage in the UI path.
- [ ] E2. `McpServerFormDialog`: one component for Add and Edit (name
      full row, transport segmented, stdio: command/args DynamicRows/env
      KeyValueRows/cwd, http: url/headers KeyValueRows, enabled switch,
      description, inline validation incl. duplicate names, dirty-close
      AlertDialog).
- [ ] E3. Integrations MCP workspace: header `Form | JSON` segmented
      toggle; list rows show name/transport badge/enabled switch/scope
      only (no secrets); old 3-field Add dialog and inline structured
      editor removed.
- [ ] E4. i18n: `mcp.form.*` keys in both catalogs.
- [ ] E5. Focused Vitest: draft-sync helpers (form→JSON→form preserves
      comments/unknown fields; invalid JSON blocks save, keeps draft) in
      `src/tests/` next to existing mcp tests.
- Validate: `pnpm typecheck` + `pnpm vitest run src/tests` (mcp-focused
  files).

## Final

- [ ] `pnpm build` passes.
- [ ] Report surfaces changed, files touched, and remaining risks; hand
      verification list to user: typecheck, focused MCP vitest, build,
      Electron Playwright MCP/Integrations flows, dark/light ×
      wide/narrow screenshots, locale parity.
- [ ] After user verification: spec update (frontend specs reflect the
      new frame), then commit only this task's files.

## Rollback points

- After each phase, `git status` shows only planned files; revert a phase
  with `git checkout -- <phase files>` (no commits exist yet).
- If the keep-mounted chat causes hidden-subtree bugs, fall back to
  unmount-on-switch for chat (state loss documented) rather than widening
  scope.
