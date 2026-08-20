# Codex-Style Project And Chat Sidebar

## Goal

Replace the current repeated workspace/recent/history structure with the clear
hierarchy shown in the supplied Codex references: project folders contain their
tasks, while conversations that have no project directory appear separately
under `最近`.

## Background And Confirmed Decisions

- The current `Sidebar` repeats one project across `当前工作区`, `最近项目`, and
  `历史会话`, then adds a modified-file count that does not explain navigation.
- `SessionList` mixes task title, repository name, time, search, pagination, and
  actions into a separate global history list, obscuring project ownership.
- The user confirmed a full information-architecture replacement rather than a
  visual-only restyle.
- The latest reference establishes two visible groups: `项目` contains folder
  rows with task rows beneath them; `最近` contains chats such as `日常聊天` that
  were started without choosing a project directory.
- The earlier confirmed toggle requirement remains: the left sidebar control
  moves to a stable leading `ChatHeader` slot mirroring the right inspector
  control.

## Requirements

### Project Hierarchy

- Render `项目` as the first navigation group. Each saved workspace appears once
  as a folder row using the standard navigation icon family. The list contains
  only directories explicitly chosen through PiPilot's folder picker; there is
  no disk/Git/home-directory discovery.
- Folder rows expand and collapse independently. Expanding a project lazily
  loads its bounded read-only official Pi session catalog from a directory
  previously observed from Pi, without starting a Pi process. A never-activated
  project shows `打开项目以加载任务` instead of guessing Pi's session path;
  selecting that action performs the controlled project activation and learns
  the catalog directory. The active project expands by default.
- Render each expanded workspace's Pi sessions directly beneath it as task
  rows, newest first. Start with a compact bounded subset and expose older
  catalog rows through an inline `显示更多` action rather than global pagination.
- An available project with no session shows `开始任务` as its child action.
- The selected task uses the compact selected-row treatment from the reference.
  Its active planning/running state uses a stable right-aligned activity
  indicator with an accessible status label and tooltip.
- Retain rename, fork, and other still-supported official Pi session actions in
  an overflow menu. Do not restore removed pin/delete behavior.
- Retain app-owned project pinning/reordering in the project row's overflow menu;
  only the removed session pin/delete actions stay absent.
- Put an accessible add-folder action beside the `项目` heading so the existing
  choose/open-directory workflow remains discoverable after removing `当前工作区`.
- Remove the permanent `当前工作区`, `最近项目`, and `历史会话` sections, the
  sidebar modified-file count, the global session search field, and pagination
  controls from this navigation surface. File changes remain in the inspector.

### Projectless Recent Chats

- Render `最近` below `项目` and list only persisted projectless Pi chats there,
  newest first. Do not duplicate project tasks in this group.
- A projectless chat is a real conversation with no user-selected workspace,
  not a synthetic folder row or a fake project.
- Selecting a recent chat switches the active Pi runtime/session to the managed
  projectless context and highlights the chat row.
- The projectless runtime, storage, empty/project-specific states, and creation
  action are owned by sibling task `08-08-projectless-chats`; this task consumes
  its explicit navigation contract.

### New Conversation Control

- Replace the single-action `新建会话` button with the confirmed split control.
  The primary action creates a task in the active project; if the active scope
  is projectless or no project exists, it creates a projectless chat.
- A compact secondary quick-chat action always starts a projectless chat. Both
  actions have distinct localized labels/tooltips and keyboard focus targets.
- Starting either scope uses the existing active-run switch confirmation and
  returns to the chat view only after the selected operation is accepted.

### Header And Collapsed State

- Keep the PiPilot brand row but move its collapse/expand control into the fixed
  leading `ChatHeader` slot. Both left and right panel controls use the same
  `32 x 32` geometry, Tabler family, focus behavior, tooltip, and alignment.
- Keep the current sidebar width and animation unless spacing must change to fit
  the confirmed hierarchy.
- In collapsed mode, preserve direct access to starting a chat and selecting
  projects/recent chats through tooltips or a compact flyout; do not reduce the
  navigation to ambiguous unlabeled status dots.

## Acceptance Criteria

- [ ] The sidebar has `项目` and `最近` groups matching the supplied reference's
      hierarchy and spacing without reproducing unrelated Codex branding.
- [ ] A project name appears once as a folder row, and the active project's Pi
      sessions appear immediately beneath it as task rows.
- [ ] An available project with no session exposes `开始任务`; unavailable
      projects remain identifiable and cannot start a task until reopened.
- [ ] Expanding an inactive project with an observed Pi directory lazily reads
      its bounded catalog without starting Pi; a never-loaded project offers an
      explicit activation action, and selecting a task cannot display stale
      children from another project.
- [ ] The selected running/planning task has a stable right-aligned activity
      indicator; waiting, failed, and completed states have accessible labels.
- [ ] `最近` lists only projectless chats in descending update order and never
      duplicates a project task.
- [ ] Selecting a projectless chat activates it without adding a fake workspace
      to `项目`.
- [ ] The old three section labels, sidebar modified-file metadata, permanent
      session search, pagination controls, and session pin/delete affordances
      are gone.
- [ ] Rename, fork, and other retained official Pi actions remain reachable from
      task/chat overflow menus; workspace pinning remains in project menus while
      session pin/delete remain absent.
- [ ] The split `新建会话` control creates in the active project through its main
      action, always offers a projectless quick-chat action, and defaults the
      main action to projectless when no project is active.
- [ ] A clearly labeled project add-folder action preserves the existing local
      directory picker.
- [ ] The left sidebar toggle remains at the same coordinates across both
      sidebar states and mirrors the inspector toggle; `Cmd/Ctrl+B` uses the
      same state owner.
- [ ] Focused typecheck/build and Electron or Playwright interaction checks cover
      project switching, empty project, projectless recent chat, selected and
      running rows, overflow actions, and both sidebar widths.

## Out Of Scope

- Reproducing Codex remote-host badges, online indicators, worktrees, cloud
  execution, project collaboration, or its exact proprietary icons.
- Eagerly loading every inactive-project session catalog or keeping multiple
  local Pi processes running solely to decorate the sidebar.
- Converting an existing project task into a projectless chat or moving a chat
  between projects.
- A replacement global search/archive screen; it may be planned separately if
  the bounded navigation list becomes insufficient.

## Dependencies

- Depends on `08-08-projectless-chats` for the typed projectless scope, recent
  chat catalog, and new/open actions.
- Depends on `08-08-official-pi-session-catalog` for bounded per-project catalog
  reads and opaque official session selection.
- Coordinates final `App`, workspace Store, shared navigation types, and locale
  changes after those producer contracts land; it does not redefine them.
