# Composer @ File And Skill Mentions

## Goal

Give PiPilot one Codex-style `@` interaction for referencing project paths and
official Pi Skills directly inside the Composer. A selected item must remain a
visible, atomic inline mention at the caret while the outgoing message stays
compatible with Pi 0.84.1's official RPC and Skill expansion behavior.

This removes the need to understand a separate context-chip area and lets the
same keyboard-first interaction work for both common mention types.

## Confirmed Facts

- `Composer` is currently a controlled `<textarea>` with a separate toolbar
  path picker and external `WorkspacePathSearchEntry[]` chips
  (`src/components/chat/Composer.tsx:231`,
  `src/components/chat/Composer.tsx:363`, and
  `src/components/chat/Composer.tsx:724`). Matching Codex's inline mention
  behavior therefore requires an editor migration, not only another popover.
- Main already owns bounded canonical relative-path search and returns at most
  100 files/directories (`src/main/workspace/workspace-content-service.ts:363`
  and `src/shared/workspace-content.ts:4`). The renderer must reuse this API and
  must not scan the filesystem itself.
- `App` supplies path search only for a user-selected project
  (`src/App.tsx:561`). Projectless chats have no project path source.
- The active Pi process is the sole Skill catalog. The current slash projection
  accepts only official `get_commands` rows whose source is `skill` and whose
  name is `skill:<name>` (`src/renderer/composer/skill-commands.ts`). PiPilot
  must not scan Skill directories or read `SKILL.md` itself.
- Pi 0.84.1 expands a Skill only when outgoing text starts with
  `/skill:<name>`. Its installed `_expandSkillCommand` extracts one leading
  Skill and treats the remaining text as arguments. `prompt`, `steer`, and
  `follow_up` all use that official expansion path.
- Codex's March and April 2026 changelog entries describe Skills and files in
  the Composer `@` menu. Read-only inspection of the locally installed Codex
  bundle further shows a structured editor with atomic file and Skill mention
  nodes. The bundle inspection is implementation evidence, not a public OpenAI
  API contract.
- The current Composer also supports official slash/extension commands, local
  `/skills` navigation, image paste/drop, Queue/Steer submission, draft
  replacement, and scope/session/runtime generation resets. The migration must
  preserve these workflows.

## Requirements

### Unified @ Menu

- Typing `@` at the caret opens one grouped candidate surface when `@` begins a
  token at the start of text or after whitespace. It works in the middle of a
  multiline draft; an `@` embedded in an email-like word remains ordinary text.
- The active query may contain spaces so paths with spaces and Skill metadata
  remain searchable. A hard break, explicit dismissal, selection, or caret move
  outside the range ends the query.
- The menu contains a **Files** section and a **Skills** section. A bare `@`
  shows the project's root path candidates and every current authoritative
  Skill. Text after `@` filters both sections without merging their identities.
- The Files section uses the existing Main search result, including canonical
  relative paths, file/directory type, truncation, loading, empty, and error
  states. The Skills section uses only the active generation's hydrated
  `get_commands` snapshot and its independent loading/error/unavailable state.
- In projectless chat, Files is omitted and no path request is made; Skills
  remains available when the official catalog is ready.
- The toolbar `@` control opens the same menu at the current caret through a
  tagged synthetic trigger. Escape removes that trigger/query and restores the
  pre-open document, while Escape after a user-typed `@` keeps the typed text.
  The toolbar must not retain a second search input, candidate model, or
  selected-context store.
- Arrow Up/Down changes the active candidate, Enter selects it, Escape dismisses
  without submitting, and pointer selection is supported. Selection restores
  editor focus and places the caret after the inserted mention.
- The `@` menu and leading `/` picker are mutually exclusive and consume each
  keyboard event at most once. IME composition never opens, selects, or submits
  a candidate prematurely.

### Inline Mention Model

- A file or directory selection replaces exactly the active `@query` range
  with one non-editable inline mention. Its trusted data is limited to the
  canonical project-relative path and file/directory type returned by Main.
- A Skill selection creates the same kind of atomic inline interaction, backed
  by the exact official command name and display metadata from the current Pi
  generation. The UI never stores or exposes a Skill filesystem path.
- Mentions move with surrounding text, select/delete atomically, and have a
  visible focus state and accessible label. Backspace/Delete must not leave a
  hidden partial identity in the document.
- File/directory mentions are deduplicated by canonical relative path. Repeating
  a selection reuses the existing identity rather than creating duplicate
  outgoing references.
- A draft can contain at most one structured Skill mention because Pi 0.84.1
  supports one leading forced Skill per message. Selecting another Skill
  replaces the prior Skill mention while preserving all ordinary text and file
  mentions.
- Pasted HTML or editor JSON cannot manufacture trusted mentions. Normal paste
  produces plain text; copy exposes a deterministic plain/Markdown form rather
  than private node attributes.

### Skills And Slash Commands

- Keep `/skills` as a Codex-like alternate discovery route and as PiPilot's
  existing local navigation row. Selecting a Skill through `/skills` inserts
  the same structured Skill mention used by `@`, so there is one draft model.
- Manual raw `/skill:<name> ...` text remains valid and passes to Pi unchanged.
  PiPilot does not convert arbitrary typed slash text into a trusted mention.
- Non-Skill official slash/extension commands remain plain command text. A
  structured Skill mention cannot coexist with a leading executable slash
  command; the conflicting selection is disabled with a localized reason rather
  than producing an invalid combined invocation.
- A structured Skill also cannot coexist with a manually typed leading
  `/skill:` invocation. The user keeps either the raw invocation or the selected
  atom; PiPilot never sends two competing Skill commands.

### Serialization And Submission

- File/directory mentions serialize in place as deterministic escaped relative
  Markdown links. For a simple path, the form is
  `[@src/app.ts](src/app.ts)`; directory labels and destinations append one
  trailing slash while identity remains the canonical Main-returned path. The
  outgoing payload contains no absolute path, file content, or private mention
  object.
- The serializer extracts the one structured Skill mention from its visual
  position, removes only that atomic node and its insertion separator from the
  body, and prefixes the outgoing text with the exact official
  `/skill:<name>`. This compatibility mapping is used for Prompt, Follow-up,
  and Steer, so Pi performs the expansion.
- Selecting an inline file mention replaces the old external chips and the
  appended `Referenced workspace paths` block. A message must not include both
  formats for the same selection.
- Ordinary text and line breaks are preserved except for the documented Skill
  prefix mapping. Existing Pi behavior may trim Skill arguments after the
  official command is expanded.
- Submission captures one editor document revision plus its images and scope.
  It clears only the accepted captured revision in the same scope and preserves
  the document and attachments on validation or RPC failure.

### Lifecycle And Existing Composer Behavior

- Every async file query is bound to the active `scopeKey`, editor revision,
  mention range, and request sequence. Caret/token changes, menu dismissal, or
  scope/session/runtime generation replacement invalidate late responses.
- A scope/session/generation replacement closes both menus and removes trusted
  path/Skill identities from the prior context before a new submission can be
  made. Ordinary draft text follows the existing draft lifecycle and must not
  be silently submitted with stale mention metadata.
- Image paste/drop, attachment validation, draft replacement, model state,
  extension commands, Queue/Steer behavior, keyboard submission, and accepted
  submission clearing retain their current observable behavior.
- The editor remains a plain-message Composer with mention atoms. No rich-text
  formatting toolbar or additional document semantics are introduced.

## Acceptance Criteria

- [ ] In a project chat, bare `@` shows grouped Files and Skills; a query filters
      both, and selecting either inserts an atomic inline mention at the caret.
- [ ] In projectless chat, `@` can show hydrated Skills but never calls project
      path search or exposes the application-private workspace.
- [ ] The toolbar `@` control, typed `@`, and `/skills` selection converge on one
      editor document and one Skill/file candidate model; no external context
      chips or duplicate path picker remain.
- [ ] Keyboard, pointer, focus restoration, atomic deletion, multiline caret,
      clipboard, and IME behavior work without overlapping `/` and `@` menus.
- [ ] Files/directories serialize exactly as escaped project-relative Markdown
      links and never include absolute paths, file content, or a private RPC
      field.
- [ ] A structured Skill selected at any visual position sends exactly one
      leading official `/skill:<name>` invocation. Selecting a second Skill
      replaces the first, and invalid Skill/slash-command combinations cannot be
      submitted.
- [ ] Raw manually typed `/skill:<name>` and non-Skill official slash commands
      retain their existing behavior; PiPilot does not implement Skill loading
      or expansion.
- [ ] Scope/session/generation replacement and late async responses cannot leak
      prior file or Skill identities into the next conversation.
- [ ] Prompt, Follow-up, Steer, images, draft replacement, failure retention,
      and accepted-revision clearing pass focused and Electron workflows.
- [ ] Focused unit/component tests, `pnpm typecheck`, Electron Composer checks,
      `pnpm build`, and `git diff --check` pass on the completed worktree.

## Key Decisions

- Use one structured, inline `@` mention system for Files and Skills, matching
  Codex's interaction instead of adapting the old external-chip design.
- Keep project path discovery Main-owned and project-scoped; only the official
  active Pi command catalog supplies Skills.
- Preserve `/skills`, but make it insert the same Skill mention node as `@`.
- Represent at most one structured Skill per message and serialize it to Pi's
  required leading `/skill:<name>` form.
- Use a maintained ProseMirror-based editor adapter rather than hand-rolling
  `contenteditable` behavior.

## Out Of Scope

- Apps, chats, agents, MCP servers, web resources, or arbitrary external files
  as `@` mention sources.
- File-content expansion, semantic search, renderer filesystem scanning, or
  automatic project selection for projectless chats.
- Multiple forced Skills in one outgoing message, private Skill expansion,
  Skill directory discovery, or direct `SKILL.md` reads by PiPilot.
- Rich-text formatting, persisted cross-version draft documents, collaborative
  editing, or a general-purpose editor framework exposed elsewhere in the app.
- Main path-search limit/ranking changes or official Pi RPC schema changes.

## Deferred Items And Risks

- The structured editor increases IME, selection, clipboard, and submission
  regression surface. The design isolates it behind a Composer adapter and
  requires Electron interaction coverage before the textarea can be removed.
- Codex may add more mention sources later. This task intentionally defines only
  Files and Skills and does not create a public plugin registry prematurely.
- No persisted draft format exists, so no compatibility migration is required.
  Adding persisted structured drafts would need a separate schema review.
