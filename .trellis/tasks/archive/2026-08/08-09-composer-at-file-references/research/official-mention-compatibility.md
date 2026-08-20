# Official Mention Compatibility Research

## Codex Product Evidence

- The official Codex changelog for app 26.318/26.319 says Skills were added to
  the Composer `@` menu alongside other mentions:
  <https://developers.openai.com/codex/changelog#codex-2026-03-19-app>.
- The April 2026 Codex app changelog records app and file `@` mentions:
  <https://developers.openai.com/codex/changelog#codex-2026-04-01-app>.
- Read-only inspection of the locally installed current Codex bundle at
  `/Applications/ChatGPT.app/Contents/Resources/app.asar` shows a
  ProseMirror-style structured editor. Its `@` suggestions include Files and
  Skills, selection replaces an exact editor range with an atomic node, file
  mentions serialize as escaped Markdown path links, and Skill mentions have a
  distinct serialized form.

The changelog establishes the product interaction. Bundle details are local
implementation evidence only and must not be treated as a stable OpenAI API.
PiPilot can follow the interaction while choosing a serialization compatible
with Pi.

## Pi 0.84.1 Skill Contract

Authoritative installed package:

```text
<pi-agent-dir>/npm/node_modules/
  @earendil-works/pi-coding-agent@0.84.1
```

- `docs/skills.md` defines official Skill invocation as `/skill:<name>`.
- `docs/rpc.md` documents that prompt, steer, and follow-up expand Skills before
  queuing or sending.
- `dist/core/agent-session.js:956-969` implements `_expandSkillCommand`:
  it returns unchanged text unless `text.startsWith("/skill:")`, extracts the
  name up to the first ASCII space, loads the one matching official Skill, and
  treats the rest as trimmed arguments.
- `dist/core/agent-session.js:989-1014` applies that same expansion to `steer`
  and `followUp`.

Consequences:

1. PiPilot must serialize a structured Skill mention to one leading exact
   `/skill:<name>` command.
2. A Codex `$skill` Markdown link would not invoke Pi and must not be sent.
3. One outgoing message can force at most one Skill through the official
   mechanism. The editor must replace, not accumulate, structured Skills.
4. PiPilot must not load `SKILL.md`, choose precedence, or expand the Skill body.
   The active Pi process remains authoritative.
5. Manual raw slash text is user-authored protocol text and should remain
   unchanged rather than being silently trusted as an editor node.

## Structured Editor Dependency Research

PiPilot currently has no equivalent editor dependency. Registry metadata was
checked on 2026-08-09:

- `@tiptap/react` 3.29.2 supports React/ReactDOM 17, 18, and 19 and peers with
  matching `@tiptap/core` and `@tiptap/pm`.
- `@tiptap/starter-kit`, `@tiptap/extension-mention`, and
  `@tiptap/suggestion` are also 3.29.2.
- Tiptap's maintained Mention extension is based on ProseMirror and supports an
  atomic inline node plus a custom suggestion renderer. Official references:
  <https://tiptap.dev/docs/editor/getting-started/install/react> and
  <https://tiptap.dev/docs/editor/extensions/nodes/mention>.

Recommended exact suite:

```text
@tiptap/core@3.29.2
@tiptap/pm@3.29.2
@tiptap/react@3.29.2
@tiptap/starter-kit@3.29.2
@tiptap/extension-mention@3.29.2
@tiptap/suggestion@3.29.2
```

The direct core/pm/suggestion entries satisfy pnpm's strict peer resolution.
StarterKit should have non-message formatting disabled so PiPilot gains editing,
history, paragraph/text, hard breaks, and mention atoms without becoming a rich
text product. `cmdk` remains the existing menu implementation; no tooltip or
popover dependency is needed for the suggestions.

## Compatibility Mapping

```text
Editor document
  file mention  -> [@relative/path](relative/path) in body
  skill mention -> remove atom from body, prefix /skill:name
  ordinary text -> preserve text/line breaks
  images        -> existing official ImageContent conversion
                     |
                     v
        prompt | follow_up | steer RPC request
                     |
                     v
          official Pi Skill expansion
```

The UI may place the Skill mention at the caret like Codex, but the outgoing
mapping must move its invocation to byte zero for Pi. This is intentionally a
Pi compatibility adapter, not a reimplementation of Codex's wire format.
