# Current Composer And Context Evidence

## Existing Renderer Flow

- `src/App.tsx:550-563` supplies the active official command catalog and exposes
  `workspace.searchWorkspacePaths` only for an explicitly selected project.
- `src/components/chat/Composer.tsx:363-824` owns plain text, external path
  chips, image attachments, two-level slash picker state, draft replacement,
  submission capture, and the `<textarea>` itself.
- `ContextPicker` at `src/components/chat/Composer.tsx:231` already has bounded
  debouncing, request-sequence stale rejection, and loading/empty/error/
  truncated path states. Its useful search-state behavior can be extracted, but
  its separate input and external-chip ownership should not survive the inline
  migration.
- `SkillPicker` is already a keyboard/pointer `cmdk` surface. Its candidate row
  and catalog-state patterns are reusable inside a grouped mention surface.
- `src/renderer/composer/composer-submission.ts:50` appends selected paths in a
  `Referenced workspace paths` block. This formatter must be replaced by a pure
  structured-document serializer so inline file mentions do not also produce a
  second external list.
- `scopeKey` includes conversation scope, active session, and runtime generation.
  It is the existing authoritative invalidation key for menus, captured submits,
  attachments, and draft replacement.

## Existing Main Boundary

- `src/main/workspace/workspace-content-service.ts:363` owns filesystem search,
  containment, symlink handling, ignored directory policy, ranking, and result
  bounding. The result schema exposes canonical workspace-relative path and
  file/directory type only.
- `src/shared/workspace-content.ts:4` caps results at 100. The Composer should
  treat truncation as presentation state rather than request an unbounded list.
- `src/store/workspace.tsx:904` and the existing workspace IPC/preload facade
  already provide the only path-search call this feature needs. No new Main,
  preload, shared, or IPC method is justified.

## Migration Seams

- Replace direct string ownership with a narrow editor adapter that can return a
  revisioned JSON snapshot, set a plain-text draft replacement, focus the caret,
  insert/replace a mention, and clear one captured revision after acceptance.
- Keep candidate projection and outgoing serialization as pure renderer helpers
  rather than embedding protocol rules in React event handlers.
- Preserve `cmdk` for the popup interaction, but drive it from the structured
  editor's authoritative suggestion range. Do not add a second positioning or
  menu dependency.
- Bind file requests to `scopeKey`, document revision, exact suggestion range,
  and request sequence. A response is selectable only if all four still match.
- Let the toolbar `@` action create a tagged synthetic trigger at the caret and
  invoke the same suggestion controller. Dismissing a toolbar-origin query
  removes its trigger/range and restores the pre-open document; dismissing a
  user-typed query preserves the user's ordinary text.
- Keep `/` navigation for commands and `/skills`, but make Skill selection call
  the editor's Skill-mention insertion command. Other slash commands remain
  ordinary text replacements.

## Behaviors At Risk

- Image paste/drop must distinguish files from ordinary pasted text/HTML; the
  editor must not deserialize arbitrary mention attributes from the clipboard.
- IME composition and Enter handling can collide with `cmdk` selection and
  Composer submit. Composition state must win until `compositionend`.
- ProseMirror undo/redo and atomic deletion must not create duplicated or
  partially editable mention identities.
- Queue/Steer submit while the agent runs must serialize the same captured
  document as Prompt and retain it on command failure.
- `draftReplacement` after Fork must replace the document deterministically and
  close any active suggestion.
- A scope or generation replacement during async search or submission must not
  clear or submit the new conversation's document.

## Expected Product Surface

- `src/components/chat/Composer.tsx`
- new focused editor/mention UI under `src/components/chat/`
- pure projection/document/serialization helpers under
  `src/renderer/composer/`
- `src/renderer/composer/skill-commands.ts`
- `src/renderer/composer/composer-submission.ts`
- `src/App.tsx` only if the Composer prop shape needs a narrow adjustment
- Composer-focused unit/component and Electron fixtures
- `src/i18n/locales/en-US.json` and `zh-CN.json`
- `.trellis/spec/frontend/official-pi-renderer.md` after the verified behavior
  is implemented

The path search service and its cross-process contracts are expected to remain
unchanged.
