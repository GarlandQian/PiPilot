# Implementation Plan

## 1. Refresh Guidance And Add The Editor Dependency

- Load the frontend official-Pi and React guidance before editing.
- Recheck the installed/registry Tiptap types and React 19 peer support.
- Add the exact 3.29.2 core/pm/react/starter-kit/mention/suggestion suite with
  pnpm, following the repository's existing frontend dependency placement and
  preserving `pnpm-lock.yaml`.
- Confirm no overlapping contenteditable, popover, or suggestion package is
  added; keep `cmdk` for menu presentation.

## 2. Build Pure Mention And Serialization Contracts

- Define discriminated file/directory/Skill candidates and trusted atom attrs in
  `src/renderer/composer/`.
- Implement grouped candidate filtering over existing path results and the
  current official Skill projection.
- Replace path-block formatting with an iterative structured-document serializer
  for plain text, hard breaks, escaped relative Markdown path links, and one
  leading official `/skill:<name>`.
- Add pure helpers for canonical path-only deduplication across file/directory
  metadata, one-Skill replacement, slash conflict, and captured-revision clearing.

## 3. Introduce The Plain Structured Composer Adapter

- Add a Tiptap-backed `ComposerEditor` limited to paragraph/text/hard-break/
  history and one custom atomic mention node.
- Implement accessible node rendering, atomic selection/deletion, safe
  plain/Markdown copy, plain-text paste, IME guards, revision tracking, focus,
  draft replacement, and an imperative capture/clear interface.
- Match the current textarea's sizing, scroll, placeholder, disabled state, and
  keyboard submission behavior before removing it.

## 4. Unify @ And / Skill Discovery

- Replace `ContextPicker` and external chips with one `cmdk` mention menu driven
  by the editor suggestion range.
- Add Files and Skills sections with independent state, stable ordering,
  keyboard/pointer operation, and no projectless file request.
- Make the toolbar `@` control open this same caret flow.
- Keep `/skills`, but insert the same Skill atom from its second level. Preserve
  plain insertion for non-Skill official commands and guard conflicts.
- Bind file requests to scope, revision, range, and sequence so stale results
  cannot be inserted.

## 5. Preserve Submission And Composer Workflows

- Route Prompt, Follow-up, and Steer through one captured editor serializer.
- Preserve image paste/drop and validation, accepted-only clearing, failure
  retention, draft replacement, extension command behavior, queue controls,
  focus, and scope/session/runtime generation reset.
- Remove old context-chip state, duplicate picker UI, and the appended
  `Referenced workspace paths` format.
- Add concise EN/ZH labels and unavailable/conflict/status text for grouped
  mention sources.

## 6. Verify And Record The Contract

After all related edits, run the smallest focused checks first:

```bash
pnpm exec vitest run tests/unit/composer-submission.test.ts tests/unit/composer-skills.test.ts tests/unit/composer-mentions.test.ts tests/unit/i18n.test.ts
pnpm typecheck
pnpm exec playwright test --config=playwright.electron.config.ts --grep "Composer mentions"
pnpm build
git diff --check
```

The Electron scenario must prove:

- typed and toolbar `@` share one grouped Files/Skills surface;
- a file selection uses real Main search and sends the exact Markdown link;
- an `@` or `/skills` Skill selection sends one exact leading official Skill;
- projectless chat never requests files but can use authoritative Skills;
- Queue/Steer and image submission preserve the same document;
- scope/session/generation replacement removes stale menu results and mentions.

Capture desktop/narrow light/dark screenshots and inspect them for popup clipping,
long-path overflow, focus visibility, and Composer layout shift. Update
`.trellis/spec/frontend/official-pi-renderer.md` only after behavior is verified.

## Risky Files And Rollback Points

- `src/components/chat/Composer.tsx` is the highest-risk integration point; keep
  the editor adapter and pure serializer reviewable as separate modules.
- `src/renderer/composer/composer-submission.ts` changes the exact text sent to
  all official submission modes; focused exact-string coverage is required.
- `src/renderer/composer/skill-commands.ts` must retain official ordering,
  validation, and first-wins behavior while exposing candidates to both menus.
- `src/App.tsx`, locales, fake-Pi fixture, and Electron spec are shared files in
  the current dirty worktree. Re-read before every edit and preserve concurrent
  migration work.
- Rollback is removal of the renderer adapter and Tiptap dependencies plus
  restoration of the textarea. Main/IPC changes must not be part of rollback
  because this task does not require them.

## Pre-Start Gate

- PRD, design, implementation plan, and both context manifests validate.
- No unresolved product or compatibility question remains.
- The user reviews the final plan and explicitly approves implementation in a
  subsequent message before `task.py start` is run.
