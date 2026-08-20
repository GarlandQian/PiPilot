# Technical Design

## Navigation Model

The renderer receives path-free current navigation data:

```text
projects[]
  id, name, available, pinned, expanded
  catalog: idle | notLoaded | loading | page(rows, cursor) | error

recentChats[]
  current-format projectless session summaries

activeScope
  project(workspaceId, optional sessionId) | projectless(optional sessionId)
```

Projects originate only from successful folder-picker records. Session catalog
rows cannot create a project or supply a cwd. Catalog pages and projectless
recent chats come from their owning Main contracts.

## Component Structure

`Sidebar` becomes layout only and composes:

- `NewConversationSplitButton` for the context-aware primary action and always-
  projectless quick-chat icon;
- `ProjectNavigationGroup` with heading add-folder action;
- `ProjectRow` with folder, expand state, availability, and project menu;
- shared `ConversationRow` for project tasks and projectless recent chats;
- `RecentChatGroup` for projectless rows only.

Rows use fixed icon/status/action tracks so loading spinners, status labels,
overflow buttons, long names, and hover states cannot shift layout. General
navigation/status icons stay Tabler; this is not the Material file-tree icon
surface.

## Project Expansion

Each project owns renderer-only expanded state. The active project expands by
default. First expansion requests a bounded catalog page from the last directory
officially observed for that scope without starting Pi; `显示更多` requests the
next cursor. `notLoaded` renders `打开项目以加载任务`, which activates the scope
on explicit user action and learns its actual directory from official state.
Selecting a task invokes the typed project/session activation operation, and
only official hydrated state marks it active.

Empty catalogs show `开始任务`; unavailable projects show a disabled state and
folder-reselection action. Project pin/reorder remains in the project overflow
menu. Session rename/fork/clone and other retained actions appear in conversation
overflow menus; session pin/delete do not.

## Projectless Chats

`最近` renders only projectless summaries. It has no folder row because
`userData/general-chat/workspace` is private implementation state, not a
project. Selecting a row uses the typed projectless session operation.

The primary new-conversation action resolves from active scope in the Store:

- active project: create a task in that explicit project;
- projectless/no project: create a projectless chat.

The secondary `TbMessagePlus`-style action always creates a projectless chat and
has its own focus target, tooltip, and accessible label.

## Panel Toggle And Collapsed Mode

The left collapse/expand button moves from both sidebar variants to a stable
leading `ChatHeader` slot that mirrors the right inspector button. `App` remains
the sole owner and `Cmd/Ctrl+B` calls the same action.

Collapsed Sidebar retains the Pi mark and new-chat quick action. Project/recent
navigation opens a compact labeled flyout from a familiar folder/chat icon;
unlabeled session dots are removed. The flyout reuses the same navigation rows
and actions rather than maintaining a second hierarchy.

## Error And Loading Behavior

Catalog not-loaded/loading, unavailable project, runtime switching, and
projectless errors remain scoped to their row/group. A failed switch keeps the
previous confirmed selection. Layout dimensions remain stable and all icon-only
controls have tooltips and keyboard focus.

This is a direct UI replacement with no adapter for the old current/recent/
history shape or session search/pagination state.
