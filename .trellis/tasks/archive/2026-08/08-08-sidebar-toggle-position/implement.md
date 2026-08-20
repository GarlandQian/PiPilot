# Implementation Plan

## 1. Consume Current Navigation Contracts

- Replace `RecentProject`, global `sessions`, nullable workspace, and repository
  strings with project/catalog/recent-chat/active-scope selectors from owning
  tasks.
- Add not-loaded/lazy catalog page state per explicit project and projectless
  recent-chat state; do not derive projects from session data.
- Remove old search/page helpers and obsolete session pin/delete wiring.

## 2. Build The Project And Recent Groups

- Split `Sidebar` into the project group, folder row, shared conversation row,
  recent projectless group, and stable empty/error/loading states.
- Add independent project expansion, bounded `显示更多`, `开始任务`, project
  activation-to-load, add-folder, project menu, and retained official session
  overflow actions.
- Keep row icon/status/action tracks stable for long Chinese/English names and
  activity indicators.

## 3. Build New-Conversation And Toggle Controls

- Replace the current button with a context-aware primary action plus an
  icon-only always-projectless secondary action.
- Move the left panel toggle into ChatHeader's fixed leading slot, mirror right
  inspector geometry, and remove sidebar-hosted toggle variants.
- Replace collapsed session dots with one labeled flyout reusing the same
  project/recent navigation model.

## 4. Update App Wiring And Localization

- Wire project select/expand/start, projectless new/open, add-folder, overflow,
  and panel state through the existing owners.
- Add concise zh-CN/en-US labels for `项目`, `最近`, `开始任务`, quick chat,
  expand/collapse, loading/errors, and retained actions.
- Delete obsolete `当前工作区`, `最近项目`, `历史会话`, modified-count, search,
  pagination, session pin/delete, and dot-navigation UI keys/call sites.

## 5. Verify

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/sidebar-navigation.test.ts tests/unit/workspace-state.test.ts
pnpm test:electron -- --grep "project sidebar|projectless recent|panel toggle"
pnpm test:visual -- --grep "sidebar"
pnpm build
```

Use fresh current data only. Capture expanded/collapsed, empty/unavailable/
not-loaded/loading, long labels, multiple project catalogs, selected/running task,
projectless recent chat, split action, keyboard focus, and stable toggle geometry
at desktop and narrow supported viewports.

## Ownership And Handoff

Claude Code owns Sidebar/SessionList replacement, ChatHeader toggle, App UI
wiring, and locale changes after Codex hands off scope/catalog Store contracts.
Shared `App`, Store, and schemas are serialized. No compatibility component or
old navigation adapter remains. Rollback is a code revert before release.
