# Codex tool activity presentation research

## Scope and evidence

This research compares the user-provided Codex screenshot with PiPilot's
current Renderer and public OpenAI descriptions. Direct automation of the Codex
desktop UI was attempted but the local computer-control capability explicitly
blocks controlling Codex itself. No proprietary DOM, styles, or implementation
details were inspected.

Evidence used:

- The user's current Codex screenshot showing compact response-level activity
  rows such as agents created, commands run, and messages sent.
- OpenAI's public Codex app material describing the app as a command center for
  supervising multiple agents and surfacing terminal output, diffs, test
  results, and approvals as live evidence.
- Current PiPilot source and focused tests.
- Archived 08-19 JSON/activity decisions and recent subagent timeline work.

## What the Codex reference is doing

The useful pattern is an information hierarchy, not a particular border or
font treatment:

1. The assistant narrative remains the primary reading flow.
2. Related tool work is summarized at the response level by action category and
   count.
3. The currently meaningful operation can appear as a short readable sentence.
4. Exact evidence is disclosed only when requested.
5. Expanded evidence reads like a chronological checklist or result log, not a
   matrix of transport arguments, progress JSON, result JSON, and error JSON.

This makes ten commands cost roughly one summary row until the user chooses to
inspect them. The same principle works for one or many subagents.

## Current PiPilot hierarchy

Current flow:

```text
authoritative response group
  -> one ToolCallCard per tool turn
       -> disclosure header
       -> copy toolbar
       -> Arguments section
            -> StructuredValueView disclosure/tree
       -> Progress section
            -> StructuredValueView disclosure/tree
       -> Result/Error/Patch sections
            -> StructuredValueView or another specialized renderer
```

The individual renderers are now safer and more readable than raw JSON, but the
page still has too many peer containers and disclosure levels. Repeated Bash or
subagent operations dominate the transcript even when the user only needs a
high-level account of the work.

## Existing reusable foundations

- `groupConversationTurns()` already provides the authoritative response-local
  boundary needed for aggregation.
- `ToolCall` contains stable identity, status, kind, command, progress, result,
  error, patch, and optional specialized subagent presentation.
- `subagentPresenter` already extracts a cleaned Markdown task, suppresses
  scheduler acknowledgements, and projects a bounded chronological timeline
  from observable extension messages.
- Bash already has a readable command and does not expose structured arguments.
- `MarkdownContent`, code rendering, copy controls, locale infrastructure, and
  current disclosure primitives can be reused.

No new dependency or cross-process protocol is required.

The existing Inspector is also reusable. `App` already owns whether it is open,
its width, conversation identity, and conversation jump requests. The Inspector
owns its persistent tab selection. A transient App-owned activity selection can
push a contextual detail view over the tab body and return to the preserved tab
without adding a fifth permanent tab.

## Options

### Option A: simplify each ToolCallCard

Remove nested backgrounds and labels while retaining one card per tool.

Benefits:

- Smallest patch and easiest test migration.
- Low risk to chronological rendering.

Limits:

- Ten commands still occupy ten top-level rows.
- Subagent and Bash remain visually equivalent to rare generic tools.
- Does not reproduce the central benefit of the Codex reference.

### Option B: response-level activity groups (recommended)

Add a pure Renderer projector after conversation grouping. It receives the
response group's visible tool turns and emits stable activity sections with
summaries plus ordered event rows. Single calls can use a direct compact row;
repeated calls get a count/status group.

Example:

```text
Assistant response

  Created 2 agents                         Completed
  Ran 10 commands                          1 failed
  Updated 4 files                          +120 -36
  Inspecting renderer presentation         Running
```

Expanded:

```text
  [done] Checked existing tests
  [done] rg "ToolCallCard" src tests
  [run ] pnpm exec vitest ...
  [fail] pnpm build
         TypeScript error ...
```

Benefits:

- Matches the reference hierarchy.
- Greatly reduces vertical noise.
- Preserves all current observable evidence.
- Can be introduced without protocol or execution changes.

Risks:

- Streaming updates must reconcile into stable rows rather than append
  duplicates.
- Chronology, approvals, failures, and unknown tools must not be obscured by
  aggregation.
- Requires broader component and Electron visual coverage than Option A.

### Option C: create a new cross-layer activity protocol

Emit purpose-built activity events from the Pi host/Main process.

This is not justified for the current request. The Renderer already receives
the necessary official observable data, and a visual redesign should not
expand the trusted protocol boundary.

## Recommended architecture

Use Option B with a renderer-only, response-local projector:

```text
Pi transcript turns
  -> authoritative conversation grouping
  -> pure tool activity projection
  -> compact response activity UI
  -> existing specialized evidence renderers on demand
```

The projector should:

- accept only the tool turns in one response group;
- classify into conservative categories such as shell, subagent, file/search,
  edit/patch, approval, and other;
- preserve the original sequence and stable call IDs;
- calculate terminal/running/error counts without inventing state;
- never group failures or approvals so aggressively that they become hidden;
- retain unknown calls as generic rows;
- impose explicit row, text, and output bounds;
- remain a pure function with focused tests.

The UI should:

- use one quiet activity region per response, not cards nested inside cards;
- show category/count/status at the first level;
- show chronological readable events at the second level;
- show large stdout, patches, structured data, or final Markdown only at the
  evidence level;
- allow a single Bash call to skip a redundant category wrapper;
- automatically collapse settled non-error detail while keeping failures easy
  to inspect;
- preserve explicit user expansion choices across streamed updates.

## Contextual Inspector detail

The user's additional Codex reference establishes a second useful layer:
selecting a subagent activity can move its long-running execution history out
of the transcript and into a parallel detail surface. The user chose to limit
this contextual route to subagents; Bash and other tools remain inline.

Recommended state:

```ts
type ActivityInspectorSelection = {
  sessionKey: string
  toolCallId: string
  returnTab: 'files' | 'diff' | 'outline' | 'terminal'
  requestSequence: number
}
```

The selection stores identity only. The selected `ToolCall` remains derived
from the current transcript projection, so streamed updates have one source of
truth and stale data cannot outlive session/generation replacement.

Recommended interaction:

1. Activate a compact activity row or its explicit detail affordance.
2. `App` opens the Inspector if necessary and records the identity-scoped
   selection.
3. Inspector temporarily renders an Activity detail header/body in place of
   the persistent tab body while retaining the prior tab value.
4. Back/Close clears the selection and restores the prior tab and focus.
5. A session/scope/generation change clears the selection before new content is
   shown.

This should be a contextual route, not a permanent fifth tab. It avoids tab
overflow at 1100x680 and matches the existing Files preview pattern of moving
from a collection to a detail surface.

## Bash-specific conclusion

The user's request that Bash need not show arguments is already semantically
implemented. The redesign should preserve that and remove the visual impression
of an argument/result form:

- first line: command summary plus state;
- expanded evidence: bounded stdout/stderr and error/exit facts;
- no cwd/timeout/envelope fields unless a future explicit diagnostic mode is
  separately approved.

Current Bash output is passed through `StructuredValueView`, while subagent
text is passed through `MarkdownContent`. A safer improvement than blindly
interpreting all stdout as Markdown is a bounded presentation classifier:

- explicit Markdown/prose result -> formatted Markdown by default;
- ANSI/control sequences, line-oriented logs, JSON, command output, and tabular
  terminal text -> Raw by default;
- formatted output always offers Raw using the same source text;
- malformed or uncertain content falls back to Raw;
- copy returns the bounded source evidence, not a DOM reconstruction.

This is presentation classification only; it must not infer new execution
facts or change the host DTO.

## Subagent-specific conclusion

PiPilot can show a Codex-like execution history only from observable
`pi-subagents` messages. It must not infer internal work. The existing timeline
is a valid source, but its container should change:

- collapsed: concise task/agent/status;
- expanded: ordered visible assistant notes, tool actions, results, and errors;
- task prompt: Markdown rendered in a secondary disclosure only when it adds
  value;
- final output: avoid duplicating content already present in the timeline;
- scheduler fan-out, workflow IDs, wake instructions, and hidden thinking stay
  filtered.

## Verification strategy

- Pure projector tests for single/repeated/mixed tools, stable streaming
  updates, failures, approvals, unknown tools, and response boundaries.
- Component tests for default summaries, independent disclosures, copy targets,
  Markdown rendering, and keyboard/ARIA behavior.
- Existing presenter tests remain the source of truth for data sanitization and
  bounds.
- Real Electron fixture containing repeated Bash, file/edit, and subagent
  events; capture light/dark desktop and 1100x680 views.
- Verify no page-level horizontal overflow and no regression to conversation
  loading/session replacement behavior.

## Final product decisions

- Response-level grouping is approved for compatible tool categories.
- Only subagents open a contextual Inspector execution view.
- Bash and other tools remain inline, with Bash Markdown/prose formatting plus
  exact bounded Raw evidence.
