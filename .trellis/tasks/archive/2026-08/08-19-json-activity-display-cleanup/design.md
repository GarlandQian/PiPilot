# Design — Structured activity and file viewer

## Product decisions

1. Passive JSON/protocol output is summarized first and disclosed on demand.
2. MCP and Models retain their explicit editable JSONC tabs. They are authoring
   surfaces, not passive output, and must keep comments and unknown fields.
3. Workspace files open inside the Files Inspector as a persistent detail view.
   The current centered preview modal is removed. Back/Close restores the tree.
4. The implementation reuses the current Markdown and highlighted-code stack.
   It does not add Monaco, CodeMirror, or another editor dependency.
5. Subagent orchestration data is presented as tool activity. PiPilot does not
   expose or invent chain-of-thought.

## Architecture

The work is renderer-owned and has two presentation paths sharing existing UI
primitives but not state:

```text
official Pi DTOs
  -> existing projector/provenance
  -> bounded structured-value projector
  -> tool presenter registry
  -> ToolCallCard / response activity rows

secure workspace preview DTO
  -> existing epoch-guarded Files tab controller
  -> file-kind projector
  -> persistent WorkspaceFileViewer
  -> Markdown preview or highlighted source
```

Main, preload, and shared official Pi schemas are unchanged. The file viewer
continues to use the existing read-only workspace preview contract, containment
checks, binary detection, and 512 KiB preview limit.

## Bounded structured values

Add a pure renderer module that accepts `unknown` or a string and returns a
serializable discriminated projection. It distinguishes:

- absent/empty values;
- plain text;
- valid JSON text;
- JSON-like but malformed text;
- scalar, object, and array values;
- truncated or unsupported input.

The projector is iterative. It reads only own data properties, never invokes
getters, and rejects functions, symbols, class instances, circular graphs, and
unsupported prototypes. It applies fixed limits for nesting depth, item count,
individual strings, and total copied/displayed bytes. Truncation remains
explicit in the projection.

The projection contains:

- a short one-line summary for collapsed UI;
- bounded typed rows/nodes for expanded scanning;
- a bounded exact-copy representation of accepted source data;
- truthful flags for truncation, malformed JSON-like text, and unsupported
  values.

Malformed JSON-like strings remain text. The UI does not claim they are parsed
JSON and does not throw.

## Tool presenter registry

Add a renderer-only exact-name presenter registry. A presenter consumes the
existing projected tool identity/state plus structured arguments/results and
returns a compact `ToolCall` presentation. Unknown tools always use the generic
fallback.

The first package-specific presenter is `subagent`:

- derive a bounded agent label and first-line task summary from known fields;
- map queue, running, detached/background, completed, and failed outcomes to
  existing tool lifecycle states;
- omit scheduler boilerplate, workflow IDs, fan-out accounting, wait guidance,
  and full delegated instructions from the collapsed row;
- render cleaned delegated tasks through the existing safe Markdown pipeline
  behind explicit disclosure, without routing them through the generic JSON
  tree or its normal string-preview limit;
- render only meaningful progress/final output as Markdown and treat detached
  scheduler acknowledgements as lifecycle state rather than result content;
- retain the cumulative `pi-subagents` result messages as a bounded ordered
  timeline of observable progress, tool actions, results, and errors. Timeline
  identities derive from result/message/content positions so repeated
  `tool_execution_update` snapshots merge without duplicating entries;
- never label the content as thought or reasoning.

Existing read/edit/shell presenters retain their specialized summaries. Their
structured detail sections use the shared viewer only where applicable. Shell
presentation is intentionally narrower: the compact row and disclosure show
the command, while progress/result/error remain structured; the generic
Arguments object is omitted so cwd, timeout, and the repeated command do not
dominate ordinary Bash activity.

`ToolCall` gains renderer-owned structured detail fields instead of forcing all
arguments/progress/results/errors into a single raw string. The projection
layer remains the only place that interprets generic Pi values.

## Structured disclosure UI

Add one compact `StructuredValueView` used by tool cards and extension response
activity. It provides:

- semantic key/value or list rows;
- bounded nested disclosure;
- separate Arguments, Progress, Result, and Error sections;
- copy actions for a section and, where useful, the whole tool record;
- internal vertical scrolling and wrapped long values;
- native buttons/disclosures with localized labels and visible focus.

It uses existing Button, Tooltip, Collapsible, typography, spacing, border, and
status tokens. It does not place cards inside cards. Error details may open once
when first observed; ordinary details stay closed.

Response-bound status, widget, notification, working, retry, and extension
errors use the same projection. Existing provenance continues to decide whether
activity belongs to a response turn or the global notification surface.

## Passive JSON audit

Search production renderer code for `JSON.stringify`, raw `<pre>`, and generic
string fallbacks. Classify each result:

1. protocol/output display: migrate to structured presentation;
2. source/code display: migrate to the shared read-only code view;
3. editable raw JSONC: retain in MCP/Models;
4. internal serialization, equality, IDs, persistence, or logging: leave
   unchanged.

This avoids mechanically replacing legitimate serialization code.

## Inspector file detail

Create `WorkspaceFileViewer` inside the Files tab. `ReadySessionOwnedTabs`
continues to own `previewPath`, loading state, preview epoch, and stale-response
rejection.

Files tab state becomes:

```text
tree -> selected/loading -> text|binary|too-large|error detail -> Back -> tree
```

The detail header contains a Back icon, bounded relative path, file type, byte
size, copy action when text is available, and Close where needed. It never
shows an unrelated absolute path.

File classification is a pure renderer helper based on the validated relative
path and preview kind:

- Markdown: rendered Preview by default, plus Preview/Source segmented tabs;
- recognized source: highlighted read-only code with language label, line
  numbers, wrap, and copy;
- JSON/JSONC: highlighted source, not a semantic editor;
- unknown text: honest plain-text source;
- binary/too-large: existing explicit unavailable states.

Refactor the reusable rendering core from the current Markdown `CodeBlock`
only if needed; do not duplicate highlighting, copy, line-number, wrap, or safe
link logic. Markdown preview uses the existing `MarkdownContent` pipeline.

The Files tab owns one bounded content scroll region. Long lines wrap or scroll
inside the source region and never create document-level horizontal overflow.
Workspace/session replacement unmounts the detail and clears its mode. Epoch
guards prevent a late preview response from replacing the current file.

## State and accessibility

Both surfaces model `loading`, `ready`, `empty`, `error`, and unsupported states
explicitly. No prior tool/file data is shown while a new identity is loading.

- disclosure and Back/Close controls use native button semantics;
- icon-only actions have localized `aria-label` and Tooltip text;
- segmented Preview/Source state is keyboard reachable and exposes selection;
- copy feedback is non-blocking;
- reduced motion disables nonessential transitions;
- light/dark themes and 1100 x 680 remain supported;
- English and Chinese strings remain in locale catalogs.

## Verification strategy

Pure unit tests cover structured values, bounds, malformed/circular input,
subagent presentation, file classification, and stale identity helpers.
Component tests cover disclosure, keyboard/copy behavior, and file mode changes.

The Electron workflow exercises real rendered running/completed tool activity
and the Files Inspector with Markdown, JSONC/source, unknown text, binary, and
too-large fixtures. It verifies Back navigation, no stale flash, no document
horizontal overflow, both themes, and the minimum window.

## Risks and mitigations

- **Large/deep data:** iterative projection and hard limits prevent stack or DOM
  explosions.
- **Secret exposure:** no new payload source is introduced; summaries are
  allowlisted and raw details remain bounded/explicit. Existing secret-redacted
  settings contracts stay authoritative.
- **Presenter drift:** exact tool-name matching and generic fallback avoid
  guessing for unknown packages.
- **Markdown safety:** reuse the existing sanitized link/image pipeline rather
  than a new Markdown renderer.
- **Stale file content:** retain request epochs and session-owned unmounting.
- **Visual duplication:** factor only shared primitives proven by the two real
  consumers; do not create a second design system.
