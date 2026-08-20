# Technical Design

## Architecture

```text
ComposerEditor (Tiptap document + revision)
  |-- @ suggestion range -------------------------+
  |                                               |
  |                          UnifiedMentionPicker |
  |                            |-- Files ----------+--> Main path search
  |                            `-- Skills ---------+--> official get_commands
  |
  |-- /skills selection -> insert same Skill atom
  |-- other slash command -> plain command text
  |
  `-- capture snapshot -> serializeComposerDocument
                           |-- relative Markdown file links
                           `-- leading /skill:name
                                      |
                                      v
                         existing Prompt/Follow-up/Steer actions
```

Electron Main, preload, IPC, and workspace search contracts remain unchanged.
The renderer owns only editor structure, candidate presentation, stale-response
rejection, and deterministic conversion to official Pi text plus existing image
content.

## Dependency And Editor Boundary

Add the exact Tiptap 3.29.2 suite recorded in
`research/official-mention-compatibility.md`. Follow the repository's existing
frontend dependency placement and preserve `pnpm-lock.yaml`. Configure
StarterKit as a plain message editor: Document, Paragraph, Text, HardBreak,
history/undo, and the custom Mention behavior remain; heading, lists, blockquote,
code block, links, emphasis, and other rich formatting are disabled.

Create a narrow `ComposerEditor` adapter rather than exposing Tiptap throughout
`Composer`. Its public responsibilities are:

```ts
type ComposerDocumentSnapshot = {
  revision: number
  document: JSONContent
}

type ComposerEditorHandle = {
  focus(): void
  replaceWithPlainText(text: string): void
  insertTrigger(): void
  insertMention(candidate: ComposerMentionCandidate): void
  capture(): ComposerDocumentSnapshot
  clearIfRevision(revision: number): boolean
}
```

Exact types may follow installed Tiptap types, but submission and React state
must not depend on mutable `Editor` instances outside this adapter.

## Mention Data Model

Use one custom inline atom named `composerMention` with a discriminated kind:

```ts
type ComposerMentionAttrs =
  | { kind: 'file' | 'directory'; path: string; label: string }
  | { kind: 'skill'; commandName: `skill:${string}`; label: string }
```

- File/directory attrs are created only from the current Main-returned
  `WorkspacePathSearchEntry`; paths remain canonical and project-relative.
- Skill attrs are created only from the current authoritative projected command
  catalog; no path or Skill body enters the node.
- The node is inline, atomic, non-editable, keyboard-selectable, and rendered as
  a compact mention with existing PiPilot colors and an accessible label.
- File/directory identity is the canonical relative path regardless of kind.
  Before insertion, remove/reuse an existing identical path so serialization
  cannot duplicate the same reference.
- Skill identity is singular. Inserting a Skill replaces any existing Skill
  node in one transaction and keeps the rest of the document selection stable.
- Tiptap's JSON/HTML paste parser must not accept mention attrs from arbitrary
  clipboard HTML. Only commands created by the trusted candidate controller may
  insert a mention.

## Unified Suggestion Controller

The Mention extension supplies the authoritative `from`, `to`, and query for an
`@` token. Permit the trigger at document start or after whitespace and reject
email-like embedded `@`. Allow spaces within an active query and end it at a
hard break, explicit dismissal, selection, or caret movement outside the range.
During IME composition, do not open or update the menu.

React owns a `MentionRequestKey` containing:

```ts
{
  scopeKey: string
  documentRevision: number
  from: number
  to: number
  origin: 'typed' | 'toolbar'
  requestSequence: number
}
```

Files use the existing debounced `onSearchContext(query)`. Skills are filtered
locally from `projectComposerCommands` for the current ready catalog. A result
may update/select only when every request-key field still matches the active
suggestion. Scope change, editor transaction outside the range, Escape, menu
replacement, or unmount invalidates the sequence.

Render one `cmdk` list anchored within the stable Composer surface. Its sections
are ordered Files then Skills. Each section owns its loading/empty/error state;
one failing source does not hide a ready source. In projectless mode, omit Files
without calling Main. The toolbar `@` command focuses the editor and inserts a
tagged synthetic trigger at the caret. Selection replaces its range; Escape
removes a toolbar-origin trigger/query to restore the pre-open document. Escape
for a user-typed trigger closes the menu but preserves the user's text.

The slash picker remains mutually exclusive:

- `/skills` navigates to official Skill rows; selecting a row deletes the
  leading slash query and inserts the same Skill atom.
- A non-Skill official command continues to replace the leading slash query with
  plain invocation text.
- If a Skill atom exists and the user selects/types a recognized executable
  slash command, or vice versa, the UI exposes a localized conflict state and
  does not manufacture combined protocol text.
- A leading manual `/skill:` plus a structured Skill atom is the same conflict;
  submit remains unavailable until one representation is removed.
- Raw unrecognized/manual `/skill:name` remains normal text and is submitted as
  authored.

## Serialization Contract

Implement a pure, total `serializeComposerDocument(snapshot)` helper. Walk the
Tiptap document iteratively and reject unknown block/node structure rather than
silently dropping text.

1. Paragraphs and hard breaks serialize to the existing plain-text line-break
   semantics.
2. File/directory atoms serialize in place as escaped relative Markdown links.
   The simple form is `[@src/app.ts](src/app.ts)`. The helper must escape label
   and destination metacharacters deterministically. Directory display and link
   destinations append one slash without changing the Main-returned identity.
3. The one Skill atom is recorded and omitted from the body. Remove only the
   separator inserted with that atom; do not globally trim or normalize the
   remaining message.
4. Prefix the body with `/${commandName}` and one separating ASCII space when a
   non-empty body exists. This satisfies Pi's byte-zero `startsWith` check.
5. If no Skill atom exists, return the body exactly. Manual slash text is not
   interpreted by this helper.

The old selected-context array and `Referenced workspace paths` block are
removed from the inline path flow. Images continue through
`attachmentToPiImage`; all three submission modes use the same serialized text.

## Submission And Lifecycle

Capture `{ scopeKey, revision, document, attachments }` before async image
conversion. After official command acceptance, clear only if `scopeKey` and the
editor revision still equal the captured values. A failed conversion or RPC
keeps the draft and attachments. `draftReplacement` replaces the entire editor
document with plain text, increments revision, closes both menus, and restores
focus according to existing behavior.

On `scopeKey` replacement:

- invalidate file requests and both menus;
- discard trusted mentions from the old project/catalog before enabling submit;
- reset editor submission capture and selection state;
- retain or reset ordinary text only according to the current Composer draft
  lifecycle, never by accidentally carrying Tiptap node identities forward.

## Accessibility, Clipboard, And Layout

- Keep the editor's accessible multiline textbox semantics and localized label.
- Mention atoms expose kind and label to assistive technology and have a visible
  keyboard focus/selection state.
- Reuse the existing Tabler icon family for file, directory, and Skill rows; do
  not add another icon dependency.
- `aria-activedescendant`, section labels, status rows, and keyboard behavior
  follow the existing `cmdk` pattern.
- Copy serializes the selected range to safe plain/Markdown text; pasted HTML is
  reduced to supported plain message structure.
- Preserve the Composer's stable min/max height and scrolling behavior so popup,
  atoms, attachments, queue controls, and long words do not resize or overlap
  adjacent UI.

## Compatibility And Rollback

No persisted Composer document exists, so there is no draft data migration or
legacy parser. The change is an immediate renderer cutover. The old external
chips and appended path block are removed, not retained behind compatibility
flags.

Rollback is a commit revert to the textarea adapter. Main search and official Pi
RPC contracts are unchanged, limiting rollback to renderer code and the Tiptap
dependency/lockfile entries.

## Verification Strategy

- Pure tests: document serialization, Markdown escaping, path deduplication,
  one-Skill replacement, Skill extraction at start/middle/end, slash conflict,
  malformed-node rejection, and revision-safe clearing.
- Interaction tests: grouped candidate states, keyboard/pointer selection,
  atomic deletion, toolbar parity, `/skills` convergence, IME, clipboard, stale
  requests, scope replacement, draft replacement, and failed submit retention.
- Electron workflow: real Main path search, authoritative fake-Pi command
  hydration, exact outgoing Prompt/Follow-up/Steer text, projectless Skills with
  no file request, and no stale catalog after session/generation replacement.
- Visual verification: desktop/narrow Composer screenshots with bare `@`, a
  filtered grouped menu, inline file/directory/Skill atoms, and long paths in
  both light and dark themes.
