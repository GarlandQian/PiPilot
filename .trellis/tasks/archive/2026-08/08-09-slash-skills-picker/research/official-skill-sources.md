# Official Skill Sources

## OpenAI Codex Reference

Official OpenAI documentation inspected on 2026-08-09 describes explicit skill
invocation through `/skills` or `$` mentions and progressive disclosure:

- https://developers.openai.com/codex/skills/

PiPilot adopts the discoverable slash-candidate and `/skills` navigation
interaction but does not copy Codex's skill storage or execution model.

## Pi 0.84.1 Reference

The installed official package was inspected at:

`@earendil-works/pi-coding-agent@0.84.1`

Relevant package documents and types:

- `docs/skills.md` documents `/skill:name [arguments]` and says arguments are
  appended after the skill instructions.
- `docs/rpc.md` documents `get_commands` and that skill commands are expanded by
  Pi before prompt/queue execution.
- `dist/modes/rpc/rpc-types.d.ts` defines command rows and official source
  metadata.

Pi's `get_commands` response combines extension, prompt-template, and skill
commands. Skill rows use `source: 'skill'`, names of the form `skill:<name>`,
descriptions, and `sourceInfo` such as scope and origin. `enableSkillCommands`
is enabled by default in the inspected version.

## Current Repository Seams

- `src/store/pi-rpc.tsx` already requests and generation-scopes
  `get_commands` during authoritative hydration.
- `src/shared/local-pi.ts` already validates command name, description, source,
  and `sourceInfo`; no shared RPC change is required.
- `src/App.tsx` already gates commands before passing them into Composer.
- `src/components/chat/Composer.tsx` already owns the draft, scope reset, and
  extension-command submission behavior. It uses the repository's existing
  `Command` and `Popover` primitives for context search but has no slash picker.
- `cmdk`, Radix Popover wrappers, localization, and Tabler icons are already
  installed, so no dependency is needed.

## Chosen Boundary

PiPilot adds one local, non-executable `/skills` navigation candidate. Every
executable candidate is filtered from official command metadata and inserts an
exact official invocation into the editable draft. PiPilot never reads
`SKILL.md`, scans skill directories, expands instructions, establishes
precedence, or executes a skill outside Pi's normal prompt/queue/follow-up
pipeline.

Rejected alternatives:

- scanning `~/.pi`, project `.pi`, or `.agents` duplicates Pi discovery and can
  disagree with plugins or configuration;
- immediately submitting on selection hides arguments and removes the user's
  chance to review the command;
- implementing `$skill` mentions or invented Pi built-in commands expands the
  MVP beyond the approved slash-candidate and `/skills` interaction;
- adding another command-menu dependency duplicates the current `cmdk` stack.
