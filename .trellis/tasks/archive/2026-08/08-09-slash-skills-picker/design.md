# Technical Design

## Scope And Ownership

This is a renderer-only discovery and draft-editing feature:

```text
official Pi get_commands
  -> generation/session-safe PiRpcProvider snapshot
  -> App command availability projection
  -> Composer slash candidate menu
  -> local /skills navigation row
  -> searchable official skill rows
  -> editable /skill:<name> draft
  -> existing official prompt/queue/follow-up path
```

Pi remains the only executable-command/skill discovery, precedence, expansion,
and execution authority. `/skills` is a PiPilot-only navigation row and is never
sent. There is no new IPC, filesystem scan, skill registry, or PiPilot-owned
skill parser.

## Authoritative Command And Skill Projection

Composer continues receiving the official `LocalPiSlashCommand` snapshot used
for extension-command submission behavior. A pure projection builds two views:

- top level: the local `/skills` navigation row followed by official non-skill
  commands in `get_commands` order;
- skills level: only rows where `source === 'skill'` and the official command
  name is a valid `skill:<name>` invocation.

No unsupported Pi built-in command is added. Selecting an official non-skill
row inserts its exact slash invocation just like selecting a skill; it does not
submit automatically.

Pi resolves duplicate skill names by its own ordered resource set. To keep the
picker consistent with that behavior, projection preserves `get_commands`
order and keeps the first row for each exact command name. React identity uses
the command name plus its official source metadata, but invocation always uses
the original command name rather than a renderer-generated alias.

The UI displays a readable name, official description, and compact scope/origin
metadata. It does not display or open `sourceInfo.path`, read `SKILL.md`, or
infer precedence from filesystem locations.

## Availability State

App passes an explicit command-catalog state alongside the current command
snapshot:

```ts
type ComposerCommandState =
  | { state: 'unavailable' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready' }
```

The state derives from the same active scope, selected session, runtime
generation, and hydration discriminator that gates all other session-owned UI.
Commands are exposed only in `ready`. A scope, session, or generation change
immediately closes the picker, clears its query/highlight, and prevents old
skills from remaining selectable.

Both levels distinguish:

- no selected/available Pi session;
- command hydration in progress;
- hydration failure;
- ready with no installed skills;
- ready with matching skills or no search results.

It never substitutes mock or cached cross-session rows.

## Interaction

Composer opens a controlled popover as soon as the draft begins with `/` and
the slash token contains no whitespace. The text after `/` is the top-level
query, so `/sk` filters toward `/skills`. Once whitespace is entered, the menu
closes because the user is editing arguments for a selected or manually typed
command.

The top-level list keeps focus in the Composer textarea so typing continues to
edit/filter the draft. Arrow keys move the active candidate, Enter selects it,
and Escape closes the list without changing text. Selecting `/skills` switches
the same popover to a skills level with its own focused search input and a Back
control. The original slash query remains the draft until a skill is selected.

The picker reuses the existing `Popover` and `Command` primitives and the
current Tabler icon family. It has a bounded responsive height, keyboard arrow
navigation, Enter selection, Escape dismissal, and pointer/touch selection.
Search is case-insensitive across readable name, description, scope, and
origin.

On skill or executable-command selection:

1. Replace the current slash query with `/${command.name} `.
2. Close and clear the picker.
3. Restore textarea focus and place the caret at the end.
4. Do not call `onSubmit`.

The trailing space makes task text immediately appendable. The existing send
path preserves the final text exactly and lets Pi expand the skill. Because a
skill command is not an extension command, the existing prompt/follow-up/queue
semantics remain authoritative while Pi is running.

At the skills level, Escape first returns to the top-level slash list; a second
Escape closes it. Outside dismissal preserves the slash query. A local
dismissed-query marker prevents unchanged text from reopening immediately;
editing the slash query resets it. Scope replacement always resets it.

## Component Shape

Keep trigger/draft ownership in `Composer`. Extract a private `SkillPicker`
feature component if doing so keeps focus, search, and row presentation out of
the already large Composer body. Keep pure normalization/search helpers outside
React when they improve deterministic testing.

No new dependency is required: `cmdk`, Radix Popover wrappers, localization,
and Tabler icons already exist in the repository.

## Failure Matrix

| Condition | Result |
| --- | --- |
| No selected session or Pi unavailable | Picker shows unavailable; no selectable rows |
| Current generation is hydrating | Picker shows centered loading state |
| `get_commands` hydration fails | Picker shows the typed current error |
| Pi reports no skills | Picker shows installed-skills empty state |
| Search has no matches | Picker shows search-specific empty state |
| Scope/session/generation changes while open | Close and discard old query/highlight/rows |
| Duplicate official skill name | Show/invoke the first row in Pi order |
| `/` entered at draft start | Open candidates immediately and filter from textarea text |
| `/skills` selected | Switch to the skills level; never send `/skills` to Pi |
| Escape in skills level | Return to top-level candidates and preserve draft |
| Escape/outside dismissal | Keep draft and do not auto-reopen unchanged query |
| Skill selected | Insert official invocation, focus draft, never submit |

## Verification Evidence

Focused helper/component coverage verifies official filtering, ordered
deduplication, top-level slash filtering, two-level keyboard behavior, exact
inserted text, no-submit selection, dismissal, and scope reset. The existing
Electron fake Pi workflow should expose at least one official non-skill command
and one skill, then verify `/` candidates, `/skills` navigation, and an ordinary
prompt containing `/skill:<name> arguments` unchanged.

Typecheck and renderer build verify prop/state integration. Packaging is not
needed solely for this renderer feature, but when both approved tasks reach the
desktop packaging gate, load the `electron-builder` skill before running it.

## Rollback

Rollback is a code revert. No persisted format, migration, compatibility reader,
or user skill file is created or modified.
