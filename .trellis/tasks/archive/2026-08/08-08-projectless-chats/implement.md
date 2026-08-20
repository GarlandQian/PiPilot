# Implementation Plan

## 1. Add The Current Conversation Model

- Define discriminated project/projectless scope schemas and direct new/open
  operations in shared IPC/preload types.
- Replace nullable/current-workspace assumptions in repository and renderer
  state with the new scope directly; do not add an old-schema adapter.
- Persist fresh `activeScope` and explicitly selected project records only.

## 2. Resolve The Exact Cwd In Main

- Add Main resolution for the selected project cwd and the single private
  `general-chat/workspace` cwd.
- Ensure folder-picker success is the only project creation path and canonical
  selected cwd is never widened to home or discovered from Git.
- Create only the private projectless cwd when needed; keep all paths out of
  renderer IPC and leave every session directory to Pi.

## 3. Integrate Local Pi And Catalog

- Pass resolved cwd and optional opaque selected session to the local Pi host,
  never pass `--session-dir`, then hydrate from official RPC.
- Record `dirname(get_state.sessionFile)` as disposable catalog navigation
  metadata after activation so Pi configuration remains authoritative.
- Add projectless new/open/list refresh actions backed by the current-format
  catalog; share official rename/fork/clone/etc. actions after activation.
- Apply generation invalidation and terminal cleanup on every scope replacement.

## 4. Add Desktop States

- Add `recentChats` and active-scope selectors to the workspace/navigation Store.
- Clear or disable project-only branch/file/Diff/`@` surfaces in projectless
  scope; keep terminal on the private cwd and keep global Pi/image/MCP workflows.
- Expose explicit operations consumed by the sidebar split control.

## 5. Remove Development Compatibility

- Remove references to `agent-workspace`, `agent-sessions/default`, nullable
  no-workspace runtime setup, old workspace/settings schema parsing, and all
  import/migration/cleanup branches.
- Do not read, move, delete, or test old external app data.

## 6. Verify

```bash
pnpm test:unit -- tests/unit/conversation-scope.test.ts tests/unit/workspace-repository.test.ts tests/unit/official-pi-session-catalog.test.ts tests/unit/terminal-service.test.ts
pnpm typecheck
pnpm test:electron -- --grep "projectless|explicit project folder"
pnpm build
```

Use temporary fresh `userData` only. Inspect exact child cwd/arguments, absence
of `--session-dir`, effective Pi session-location discovery, private path
invisibility, global/project resource fixture behavior, active-run switch,
restart restore, stale generation rejection, and no old path/schema references.

## Ownership And Handoff

Codex owns the Main/shared/store scope contracts and runtime/catalog integration.
Claude Code consumes those contracts in the sidebar and project-only empty
states. Pi consumes them in cost/Composer/MCP. Shared files are serialized and
no agent reverts user or sibling edits. Rollback is a code revert before release.
