# Adopt A Read-Only Diff Library

## Goal

Replace PiPilot's hand-built Diff table with the maintained React renderer from
`@pierre/diffs`, and make the entire Diff workflow read-only by deleting accept
and revert behavior across every layer.

## Confirmed Facts

- `DiffViewer` currently renders parsed rows and exposes Accept/Revert buttons.
- `WorkspaceContentService` stores tool patches/fingerprints and implements
  mutation conflict handling, while shared/IPC/preload contracts expose accept
  and revert operations.
- `@pierre/diffs@1.3.5` was the latest release verified on 2026-08-08. Its
  public React entry provides `PatchDiff`, React 19 support, unified/split
  rendering, syntax highlighting, themes, wrapping, and optional annotations.
- The inspector is width-constrained, so a unified read-only view is the default;
  review actions/annotations are unnecessary.

## Requirements

- Recheck and install the latest compatible `@pierre/diffs` release with pnpm;
  inspect its installed public exports/types before implementation and use only
  the documented React entry.
- Replace the custom row table with a small adapter around the library's
  read-only patch component. Use unified layout, current light/dark theme,
  filename language detection, existing code/terminal font settings where
  supported, line-number preference, and word-wrap preference.
- Present all changed files as one vertically scrolling Changes view. Preserve
  each file path, added/deleted counts, loading, empty working tree, Git
  unavailable, binary, deleted/new, renamed, truncated/oversized, refresh, and
  error states; remove previous/next file navigation.
- Show every bounded file summary immediately, then load visible and nearby
  patches independently with fixed concurrency. A single read or render failure
  must not block the remaining files, and stale reads after refresh/workspace
  replacement must be ignored.
- Change the workspace Diff detail contract to carry a bounded standard unified
  patch plus display metadata instead of PiPilot-parsed line rows.
- Dynamically import the Diff renderer only when the Diff tab is activated;
  provide stable loading/error fallbacks and avoid loading Shiki/language assets
  in the initial chat bundle.
- Delete Accept and Revert buttons, confirmations, callbacks, state, events,
  locales, IPC/preload contracts, Main handlers, service mutation methods,
  patch records, write/chmod/rename support used only by mutation, and
  mutation-conflict fingerprints.
- Remove `fingerprint` and custom `source: tool|git` fields from read-only change
  DTOs when they have no remaining display purpose. The working tree comes from
  current Git state; non-Git fallback patch mutation tracking is removed.
- Retain canonical workspace containment, bounded Git output, status/Diff reads,
  and explicit refresh because they are required for a correct read-only viewer.
- Do not enable library review annotations, accept/reject controls, editing, or
  a second Diff engine.

## Acceptance Criteria

- [ ] Opening the Diff tab loads a separate `@pierre/diffs` renderer chunk and
      does not add its syntax-rendering payload to the initial chat route.
- [ ] Common modified/added/deleted/renamed text files render valid unified
      patches with filename-aware syntax, theme, line numbers, and wrapping
      matching current settings.
- [ ] Binary, empty, Git-unavailable, loading, truncated/oversized, parse, and
      dependency-load failures show stable non-overlapping states.
- [ ] All bounded files and their `+/-` summaries appear in one continuous
      scroll surface without previous/next, Accept, Revert, confirmation, or
      mutation affordances.
- [ ] Patch reads are visibility-driven and concurrency-bounded; per-file
      loading/error/retry states and list truncation do not block other files.
- [ ] No production shared schema, IPC/preload API, Main handler, service method,
      store/component, shortcut, locale, mock, or active test exposes Diff
      accept/revert or mutation fingerprints.
- [ ] Viewing/refreshing a Diff cannot modify working-tree files, index state,
      permissions, or timestamps through a PiPilot write path.
- [ ] Canonical workspace containment and bounded read/output behavior remain.
- [ ] Dependency purpose/version is recorded, lockfile is preserved, and no
      overlapping Diff renderer is installed.
- [ ] Focused read-only service/component checks, bundle inspection, typecheck,
      build, and Electron visual states pass.

## Out Of Scope

- Staging, unstaging, accepting, reverting, applying, editing, commenting on, or
  approving a patch.
- Side-by-side mode, user-selectable Diff engines, or a complete Git client.
- Rendering arbitrary transcript tool patches independently of the current
  workspace Git Diff.

## Dependencies And Ownership

This task is independent of local Pi execution but must finish before the legacy
Agent cleanup removes shared mutation/fingerprint code. It owns the Diff
dependency/adapter, workspace read-only Diff DTO/service/IPC/preload flow,
inspector UI, dynamic loading, locales, mutation removal, and focused tests. It
is cross-layer and therefore requires `design.md` and `implement.md`.
