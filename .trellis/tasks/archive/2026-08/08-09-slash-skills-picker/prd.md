# Add Codex-style slash and skills picker

## Goal

Make slash commands and installed Pi skills discoverable from the Composer
through a Codex-style candidate menu while keeping Pi as the only command/skill
execution authority.

## Requirements

- Typing `/` at the start of the Composer immediately opens a searchable slash
  candidate menu. Continuing to type after `/` filters the visible candidates.
- The top-level menu contains one PiPilot navigation row, `/skills`, plus
  executable non-skill commands from the current official Pi `get_commands`
  response. The `/skills` row is never sent to Pi.
- Selecting `/skills` switches the same popover to the searchable installed-
  skills list; it does not edit or submit the draft yet.
- Populate the picker only from the current official Pi `get_commands` response
  where `source === 'skill'`; do not scan or parse skill directories in
  PiPilot.
- Show the official skill name, description, and user/project/package scope
  metadata already returned by Pi.
- Keep the list generation/session scoped so changing project, projectless
  scope, or Pi generation cannot leave skills from the previous runtime visible.
- Preserve Pi's official invocation syntax, `/skill:<name> [arguments]`, and let
  Pi expand the skill when the prompt is sent.
- Selecting a skill replaces the slash query with `/skill:<name> `,
  returns focus to the Composer, and never submits automatically. The user may
  review the invocation and add task text or arguments before sending it.
- Provide keyboard navigation, search, empty/loading/unavailable states, and a
  mouse/touch selection path consistent with existing Composer command UI.

## Acceptance Criteria

- [ ] Typing `/` at draft start immediately opens a bounded candidate menu;
      typing a slash query filters it without sending anything.
- [ ] Selecting the `/skills` navigation row opens a bounded searchable list of
      skills reported by the active Pi runtime.
- [ ] Global and selected-project skills reflect Pi's current `sourceInfo`; a
      project switch cannot show or invoke a stale project skill.
- [ ] Selecting a skill produces a valid official Pi `/skill:<name>` invocation
      without PiPilot reading `SKILL.md` or expanding its content.
- [ ] Selection only edits the draft. It does not execute the skill, and the
      caret is ready for the user to append task text or arguments.
- [ ] Skill arguments and the user's remaining prompt text are preserved exactly
      through the normal official `prompt`/queue flow.
- [ ] Missing Pi, no selected session, loading commands, no installed skills,
      and failed command hydration have distinct UI states.
- [ ] No mock skills, bundled skill registry, web implementation, or PiPilot-
      owned skill execution is introduced.
- [ ] No unsupported Pi built-in command is invented. Apart from the local
      `/skills` navigation row, executable candidates come from `get_commands`.

## Confirmed Facts

- Official OpenAI documentation says Codex supports explicit skill invocation
  through `/skills` or `$` skill mentions and uses progressive disclosure.
- Official Pi 0.84.1 exposes extension, prompt-template, and skill commands via
  RPC `get_commands`. Skill rows are named `skill:<name>` and include
  description plus `sourceInfo`.
- Pi expands `/skill:<name> [arguments]` inside its official prompt pipeline;
  arguments follow the skill instructions. PiPilot should send the invocation
  unchanged.
- PiPilot already hydrates `get_commands` and passes them to Composer, but the
  current Composer has no slash-command/skill picker. It only detects extension
  commands to choose immediate versus queued submission behavior.

## Out Of Scope

- Installing, creating, editing, enabling, disabling, or deleting skills.
- Reading `SKILL.md`, scanning `~/.pi`, `.pi`, or `.agents`, or reproducing Pi's
  precedence and discovery rules.
- Pi interactive built-in commands that are not returned by `get_commands`.
- Codex `$skill` mention syntax in this MVP unless separately approved.

## Resolved Product Decision

- `/skills` is a local navigation candidate, not an execution command. It opens
  the skills level in the same popover and is never sent to Pi.
- Selecting a skill inserts `/skill:<name> ` and keeps the draft editable; only
  the normal Send, Queue, or Follow-up action submits it through Pi's official
  prompt pipeline.
- The top-level query is the slash text in Composer. The skills level owns a
  separate search input. Escape returns from skills to the slash list first;
  Escape again closes the menu while preserving the current draft.
