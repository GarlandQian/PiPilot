# Implementation Plan

## 1. Inspect And Add The Dependency

- Recheck the latest compatible `@pierre/diffs` version and inspect its public
  React exports/types, peer requirements, CSS/assets, and bundling guidance.
- Confirm no existing dependency provides the same maintained capability.
- Add exactly one Diff renderer with pnpm and record its purpose/version.

## 2. Make Workspace Diff Contracts Read-Only

- Replace parsed line/fingerprint/source/mutation result DTOs with bounded
  metadata plus unified patch.
- Remove accept/revert IPC/preload/Main handlers and mutation events.
- Simplify WorkspaceContentService to Git status/Diff reads and delete tool
  patch/fingerprint/write/reverse-apply code.

## 3. Replace The Inspector Renderer

- Add the lazy public-library adapter and map filename, theme, typography, wrap,
  and line-number settings.
- Replace index navigation with one continuous Changes surface containing all
  file headers and summaries.
- Add visibility-driven, three-concurrent per-file patch loading, epoch-based
  stale response rejection, and independent loading/error/retry/binary/
  truncated states. Wrap the stack in the library's public React `Virtualizer`.
- Remove Accept/Revert buttons, confirmations, busy state, callbacks, shortcuts,
  locales, mocks, and obsolete behavior tests.

## 4. Verify Read-Only Behavior And Bundle

After all related edits:

```bash
pnpm test:unit -- tests/unit/workspace-content-service.test.ts tests/unit/readonly-diff-viewer.test.ts
pnpm typecheck
pnpm test:electron -- --grep "read-only diff"
pnpm build
```

Inspect output chunks and light/dark narrow/desktop screenshots. Confirm test
files/index are byte-identical before and after view/refresh scenarios.

## File Ownership And Pre-Start Gate

This child owns the Diff library/dependency, workspace Diff shared contracts,
read-only service/IPC/preload methods, inspector adapter/UI, mutation removal,
locales, and focused tests. Coordinate shared WorkspaceContentService cleanup
with file/context work and legacy Agent cleanup. Context manifests must validate.
