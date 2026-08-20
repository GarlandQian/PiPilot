# Implementation Plan

## 1. Extend Official Submission Types

- Add renderer-internal image/context submission types and deterministic context
  formatter.
- Extend prompt/steer/follow-up adapter calls to accept official images only;
  add no extra JSONL field.
- Integrate with the renderer-owned idle Prompt, running default Queue, one-shot
  Steer, and separate Stop actions without a sticky local mode.
- Preserve draft/selections until correlated command acceptance.

## 2. Implement Workspace Path Search

- Add bounded search schemas, Main service method, IPC/preload API, ranking, and
  stale-request handling using existing canonical workspace ownership.
- Remove the sensitive-name exclusion in coordination with legacy cleanup while
  keeping traversal containment and performance bounds.
- Add focused service/contract tests.

## 3. Implement Image Attachments

- Wire hidden native file input, paste, and drag/drop to one validation helper.
- Add preview chips, limits/errors, base64/MIME conversion, model capability
  handling, and deterministic object URL/byte cleanup.
- Send one captured text/images/context submission through idle Prompt, running
  default Queue, or explicit one-shot Steer.

## 4. Implement The Context Picker

- Replace the hard-coded `README.md` action with a command-style searchable
  file/directory picker and removable deduplicated chips.
- Add keyboard/focus/loading/empty/error behavior and Material file/folder icons
  when the icon sibling is available, with a non-overlapping fallback during
  integration.
- Append the stable referenced-path block at send time.

## 5. Verify

After all related edits:

```bash
pnpm test:unit -- tests/unit/workspace-path-search.test.ts tests/unit/composer-submission.test.ts
pnpm typecheck
pnpm test:electron -- --grep "composer images and context"
pnpm build
```

Exercise idle Prompt, running default Queue, and one-shot Steer through the
deterministic local Pi fixture with no optional plugin, and inspect chooser/
paste/picker/error responsive states alongside the separate Stop control.

## File Ownership And Pre-Start Gate

This child owns Composer selection/submission UI/state, image helpers, context
formatter, workspace path-search schemas/service/IPC/preload, locales, and
focused tests. Coordinate WorkspaceContentService with Diff/file-tree cleanup,
shared RPC submission types with renderer migration, and file icons with the
Material icon child. The renderer task owns queue state/modes and control
placement; this task owns the captured attachment/context payload. Context
manifests must validate before start.
