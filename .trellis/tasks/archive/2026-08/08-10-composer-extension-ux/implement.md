# Implementation Plan

## 1. Shared Picker Foundation

- Add pure option projection/navigation helpers and focused transition tests.
- Extract a single compact picker shell/row primitive from the current slash and
  mention components.
- Preserve real option IDs, listbox linkage, active scroll, pointer/keyboard
  convergence, partial source states, and stable dimensions.

## 2. Flatten Slash Commands And Skills

- Remove `SkillPickerLevel`, nested search, Back, and locally invented
  `skills-navigation` state.
- Project official Commands and authoritative Skills directly into grouped rows.
- Route query, keyboard activation, and exact insertion through the shared
  controller.

## 3. Typed-Only Mention Flow

- Render Files/Skills through the shared shell.
- Delete toolbar `@`, tooltip, editor trigger handle, and toolbar-origin
  suggestion/selection restoration.
- Keep the paperclip and all typed-trigger identity, clipboard, image,
  submission, IME, history, and scope-reset behavior.

## 4. Generic Extension UI

- Add a neutral generic tool presentation branch and bounded structured detail
  rendering.
- Replace raw always-expanded status/widget blocks with a compact collapsible
  activity strip above the Composer.
- Mount notifications inside the middle conversation column and verify layer/
  pointer behavior.
- Keep official extension dialogs unchanged.

Likely files:

- `src/components/chat/Composer.tsx`
- `src/components/chat/ComposerEditor.tsx`
- `src/components/chat/SkillPicker.tsx` or its replacement
- `src/components/chat/ComposerMentionPicker.tsx` or its replacement
- `src/components/chat/ExtensionSurfaces.tsx`
- `src/components/chat/ToolCallCard.tsx`
- `src/renderer/composer/*`
- `src/renderer/pi-rpc/presentation.ts`
- `src/store/pi-rpc.tsx`
- `src/App.tsx`
- both locale catalogs

## 5. Verification

Run once all related edits are complete:

```bash
pnpm exec vitest run \
  tests/unit/composer-skills.test.ts \
  tests/unit/composer-mentions.test.ts \
  tests/unit/composer-submission.test.ts \
  tests/unit/local-pi-rpc-renderer.test.ts \
  tests/unit/i18n.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "Composer mentions|keyboard candidates|extension surfaces"
git diff --check
```

Capture and inspect desktop/narrow light/dark screens for clipping, long-row
truncation, active/focus state, notification placement, and Composer layout
shift.

## Ownership And Handoff

This child owns Composer candidate components/helpers and generic extension
presentation. It must hand the typed activity host contract to the Plan/Retry
child. It does not edit package management/MCP services or add package-specific
adapter logic. Preserve concurrent shared-file changes and report final
`App`/provider/locale contract changes.

## Pre-Start Gate

- Parent artifacts and this child's PRD/design/plan are reviewed.
- Both context manifests contain real entries and validate.
- The parent final plan has explicit user approval before this child starts.
