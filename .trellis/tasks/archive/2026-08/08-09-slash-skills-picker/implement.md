# Implementation Plan

## 1. Project Slash And Skill Rows

- Add a small pure helper that projects the local `/skills` navigation row,
  official non-skill top-level candidates, and official skill rows from the
  active command snapshot.
- Validate `skill:<name>` command shape, preserve Pi order, and deduplicate exact
  invocation names first-wins. Do not add unsupported Pi built-ins.
- Provide searchable presentation fields from official name, description,
  scope, and origin without exposing the source path.
- Keep the original official command name for inserted invocation text.

Likely files:

- `src/renderer/composer/skill-commands.ts` (new, if extraction is useful)
- `src/shared/local-pi.ts` only if an existing exported type is insufficient;
  do not change the RPC contract for this feature

## 2. Add The Two-Level Composer Picker

- Open a controlled picker when the draft starts with `/` and its current slash
  token has no whitespace. Keep textarea focus and filter from the slash query.
- Selecting the local `/skills` row enters a searchable skills level in the
  same popover; provide Back and Escape-to-back behavior without sending it.
- Reuse existing `Command`/`Popover` primitives and Tabler icons for bounded
  search, keyboard navigation, accessible labels, pointer/touch selection, and
  the distinct availability/empty states.
- On executable selection insert `/${command.name} `, restore textarea
  focus/caret, and do not submit. Preserve the slash query on dismissal and
  suppress immediate reopening until the draft changes.
- Reset picker query, highlight, and dismissal state when `scopeKey` changes.

Likely files:

- `src/components/chat/Composer.tsx`
- `src/components/chat/SkillPicker.tsx` (new if kept separate)
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`

## 3. Connect Authoritative Availability

- Derive a discriminated command-catalog state from the existing conversation
  presentation/runtime hydration state in App.
- Pass no commands from an empty, loading, failed, stale, or replaced session.
  A ready state may legitimately contain zero skills.
- Preserve the existing extension-command lookup and ordinary
  prompt/follow-up/queue behavior after a concrete skill invocation is inserted.

Likely files:

- `src/App.tsx`
- `src/components/chat/Composer.tsx`
- `src/store/pi-rpc.tsx` only if the current public hydration discriminator
  cannot express command availability without guessing

## 4. Focused Evidence

- Cover official filtering, first-wins deduplication, top-level slash filtering,
  and skill search in a focused unit test when extracted as a pure helper.
- Extend the fake Pi command fixture with one official non-skill command and one
  `source: 'skill'` row. Extend the existing Electron workflow with `/` trigger,
  `/skills` navigation, keyboard/pointer selection, exact draft insertion, no
  automatic submit, argument entry, and unchanged official prompt payload.
- Verify scope/session replacement closes the picker and cannot expose the
  previous project's skill.

Likely tests:

- `tests/unit/composer-skills.test.ts` (new if a pure helper is added)
- `tests/fixtures/fake-pi.mjs`
- `tests/electron/pipilot.electron.spec.ts`

## Implementation Ownership

After explicit approval/start, a renderer worker may own the pure projection,
picker, Composer integration, locales, and focused unit evidence. Root owns App
integration, fake Pi/Electron coordination with the chat-action task, conflict
resolution, and final checks. All implementers must re-read shared dirty files
before editing and preserve unrelated user/concurrent changes.

## Verification

Finish all related edits before checking, then run the smallest relevant set:

```bash
pnpm exec vitest run tests/unit/composer-skills.test.ts
pnpm typecheck
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "local Pi RPC workflow"
pnpm build
git diff --check
```

Skip the focused unit command if no testable pure helper is introduced. Request
the required GUI escalation for Electron tests. If packaging is later run as
part of the combined desktop acceptance, load the `electron-builder` skill
first and report only the platform/signing evidence actually exercised.

## Completion Conditions

- `/` opens the candidate menu and `/skills` is its only local navigation row;
  `$skill` remains out of scope.
- Skill rows come only from the current official `get_commands` result.
- Executable top-level rows come only from the official command snapshot; no Pi
  built-in behavior is invented.
- Selection inserts an exact editable official invocation and never submits.
- Scope/session/generation changes cannot retain an old picker or skill row.
- PiPilot does not read, scan, install, expand, or execute skills itself.
