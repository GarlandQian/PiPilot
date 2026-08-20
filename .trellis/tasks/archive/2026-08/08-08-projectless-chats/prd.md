# Support Projectless Chats

## Goal

Let users start and continue persistent official Pi conversations without
choosing a project directory, matching the reference's `最近` / `日常聊天`
workflow while keeping every user-selected project and its tasks under `项目`.

## Confirmed Product Boundary

- A project exists only when the user explicitly chooses a folder. PiPilot does
  not scan the disk, infer a Git repository, or automatically use the home
  directory as a project.
- Projectless chats use the private persistent working directory
  `userData/general-chat/workspace`. On macOS this resolves below
  `~/Library/Application Support/PiPilot/general-chat/workspace`.
- Project and projectless sessions both remain in the selected local Pi's own
  session storage. PiPilot does not pass `--session-dir`; Pi applies its normal
  environment, settings, and default storage behavior organized by cwd.
- The private working directory never appears under `项目` and is never exposed
  as a user-selected workspace.
- Global Pi settings, credentials, packages, extensions, skills, prompts, and
  optional plugins still load. Project-level `.pi`, `AGENTS.md`, and Git context
  come only from a user-selected project and are absent from projectless chats.
- This is an unreleased greenfield implementation. There is no compatibility,
  import, conversion, alias, cleanup, or migration for `agent-workspace`,
  `agent-sessions/default`, old workspace/settings schemas, or earlier sessions.
- Official OpenAI documentation confirms the product distinction between a
  project and a self-contained chat started without one:
  <https://learn.chatgpt.com/docs/projects>.

## Requirements

### Explicit Conversation Scope

- Model the active conversation as a discriminated scope:
  `{ kind: 'project', workspaceId }` or `{ kind: 'projectless' }`. Do not use a
  fake workspace, magic UUID, empty path, or overloaded nullable current ID.
- Persist only the new current scope and normal project records. A fresh install
  defaults to `projectless`; no old persisted shape is accepted or upgraded.
- Project session summaries remain under their project. Projectless session
  summaries appear only in `最近`, newest first, through the official session
  catalog sibling.

### Official Pi Runtime

- Create the projectless cwd on first use and launch the same user-selected
  latest official `pi --mode rpc --approve` executable used by project tasks,
  without a session-directory override.
- Use only documented Pi commands, snapshots, events, stats, image payloads, and
  supported extension UI. Do not add an SDK, private import, copied client,
  second protocol, or plugin prerequisite.
- New/open/rename/fork/clone, entries/tree inspection, compact,
  automatic-retry controls, steer/follow-up, model/thinking, images, stats,
  commands, official bash, and supported extension UI behave the same as in a
  project task wherever official RPC supports them.
- Switching project ↔ projectless replaces the owned Pi process through the
  generation-safe runtime contract, cancels stale requests/subscriptions, and
  hydrates only official state from the new scope.

### Desktop Behavior

- Show projectless chats under `最近` and never add the private directory to the
  project repository, folder picker history, project file tree, or project
  settings.
- While projectless is active, project name/branch, Git Diff, project file tree,
  and workspace `@` search show a clear no-project state rather than stale data.
- The integrated terminal remains available with
  `userData/general-chat/workspace` as cwd, but labels the scope as a general chat
  rather than displaying it as a project.
- Image chooser/paste/drop, direct file chooser attachments owned by Composer,
  official cost/context, global Pi plugins, supported extension UI, and optional
  MCP remain usable under their normal prerequisites.
- Files created by Pi or the terminal in the private workspace persist across
  app restarts. Exposing or exporting them is a separate file workflow; the
  directory itself remains hidden from `项目`.

### Creation And Navigation

- Use the confirmed split `新建会话` control. Its primary action creates a task
  in the active user-selected project; if no project is active, it creates a
  projectless chat. Its secondary quick-chat icon always creates a projectless
  chat.
- Both actions have distinct localized accessible names/tooltips and use the
  same active-run confirmation plus runtime replacement rules.
- A fresh install with no project can create, name, use, persist, and resume its
  first projectless chat without opening the folder picker.

## Acceptance Criteria

- [ ] Fresh startup creates/uses `general-chat/workspace` as the projectless cwd;
      it never appears in `项目`, and PiPilot creates no private session root.
- [ ] A project is created only after an explicit successful folder selection,
      and its exact canonical path is the Pi cwd. Home-directory and disk/repo
      auto-discovery do not exist.
- [ ] Projectless has an explicit typed scope and never uses a fake workspace ID,
      empty cwd, `agent-workspace`, or `agent-sessions/default`.
- [ ] A user can send through the selected latest official Pi, quit, relaunch,
      and resume multiple projectless chats from `最近` in newest-first order.
- [ ] Project and projectless launches omit `--session-dir`, and catalog
      discovery follows the actual `get_state.sessionFile` returned by Pi,
      including Pi-configured session locations.
- [ ] Switching project ↔ projectless never leaks transcript, status, stats,
      terminal, branch, file tree, Diff, or project resource state.
- [ ] Project file tree, Git Diff, branch, and workspace `@` show a no-project
      state; terminal, images/direct attachments, cost/context, global Pi
      plugins, supported extension UI, and optional MCP remain available.
- [ ] The split control creates in the active project through its main action,
      always offers quick projectless chat, and defaults main action to
      projectless when no project is active.
- [ ] Projectless session actions use documented Pi RPC and no parallel
      transcript/session store or old-schema adapter exists.
- [ ] Focused scope/repository/runtime/store/terminal/Electron checks cover fresh
      startup, multi-chat ordering, restart restore, project ↔ chat switching,
      active-run confirmation, crash/restart, and project-only empty states.

## Out Of Scope

- Importing, moving, deleting, interpreting, or supporting any previous PiPilot
  app data, session directory, settings schema, or transcript.
- Treating the private workspace as a project or allowing it to load a selected
  project's `.pi`, `AGENTS.md`, or Git context.
- Moving/converting a conversation between project and projectless scopes.
- Reproducing Codex cloud, worktree, remote-host, collaboration, or proprietary
  quick-chat internals.

## Dependencies

- Depends on `08-08-official-pi-remote-runtime` for current latest-Pi startup,
  owned cwd inputs, Pi-owned session storage, and generation-safe replacement.
- Depends on `08-08-official-pi-session-catalog` for current-format read-only
  projectless summaries and opaque session selection.
- Provides the scope, new/open, empty-state, and terminal target contracts used
  by `08-08-sidebar-toggle-position`, session cost, Composer, and final checks.
