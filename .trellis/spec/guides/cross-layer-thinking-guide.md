# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:

- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:

- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary              | Common Issues                     |
| --------------------- | --------------------------------- |
| API ↔ Service         | Type mismatches, missing fields   |
| Service ↔ Database    | Format conversions, null handling |
| Backend ↔ Frontend    | Serialization, date formats       |
| Component ↔ Component | Props shape changes               |

### Step 3: Define Contracts

For each boundary:

- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

### Mistake 4: Every Consumer Parses The Same Payload

**Bad**: A command reads JSONL events and casts fields inline:

```typescript
const thread = (ev as { thread?: string }).thread;
const labels = (ev as { labels?: string[] }).labels;
```

This looks local, but it means every consumer owns a private version of the
event contract. The next field change will update one command and miss another.

**Good**: Decode once at the event boundary, then export typed projections:

```typescript
if (!isThreadEvent(ev)) return false;
return ev.thread === filter.thread;
```

**Rule**: For append-only logs, JSON streams, RPC payloads, or config files,
create one owner for:

- event / payload type definitions
- type guards and normalization from `unknown`
- metadata projections used by UI commands
- reducers that replay state from the source of truth

Rendering code may format fields, but it must not redefine the payload contract.

---

## Checklist for Cross-Layer Features

Before implementation:

- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:

- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip
- [ ] For rich-content unions, verified every supported variant survives each
      presentation DTO and reaches the rendered consumer; checking only the
      source payload or transport response is insufficient
- [ ] Checked that consumers import shared decoders / projections instead of
      casting payload fields locally
- [ ] Checked that derived state points back to the source event identifier
      (`seq`, `id`, `version`) instead of inventing a second cursor

---

## Cross-Platform Template Consistency

In Trellis, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/trellis:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In Trellis,
`.trellis/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
      writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
      such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
      the older `.trellis/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
      assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

---

## Versioned Documentation Boundary

Versioned documentation is a cross-layer boundary: source paths, `docs.json`
version routing, and the rendered version selector must all describe the same
release line.

### Checklist: Before Editing Versioned Docs

- [ ] Identify the target release line: stable, beta, or RC
- [ ] Verify the edited MDX path matches that line:
  - stable: `docs-site/{start,advanced,...}` and `docs-site/zh/{start,advanced,...}`
  - beta: `docs-site/beta/**` and `docs-site/zh/beta/**`
  - RC: `docs-site/rc/**` and `docs-site/zh/rc/**`
- [ ] Verify `docs.json` navigation points the version label to the same paths
- [ ] Grep the opposite tree for release-line-specific terms before committing
- [ ] Treat beta content appearing under root release paths as a source-path bug,
      not a rendering bug

**Real-world example**: A beta-only task workflow change documented
`prd.md` + `design.md` + `implement.md`, task-creation consent, and Codex
mode banners under root `start/` and `advanced/` paths. The docs site then
served 0.6 beta behavior under the Release selector. The fix was to restore root
release docs, move the 0.6 content to `beta/` and `zh/beta/`, and add a grep
audit for beta markers against the root release tree.

**Real-world example**: Codex inline mode changed workflow platform markers from
`[Codex]` / `[Kilo, Antigravity, Windsurf]` to `[codex-sub-agent]` /
`[codex-inline, Kilo, Antigravity, Windsurf]`. Fresh init was correct, but
`trellis update` only merged `[workflow-state:*]` blocks and preserved stale
markers outside those blocks. Result: upgraded projects got new hook scripts
but old workflow routing, so `get_context.py --mode phase --platform codex`
could return empty Phase 2.1 detail.

---

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:

- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:

- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@mindfoldhq/trellis` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## Cross-Platform Template Consistency

In Trellis, command templates (e.g., `record-session.md`) exist in **multiple platforms** with identical or near-identical content. This is a cross-layer boundary.

### Checklist: After Modifying Any Command Template

- [ ] Find all platforms with the same command: `find src/templates/*/commands/trellis/ -name "<command>.*"`
- [ ] Update all platform copies (Markdown `.md` and TOML `.toml`)
- [ ] For Gemini TOML: adapt line continuations (`\\` vs `\`) and triple-quoted strings
- [ ] Run `/trellis:check-cross-layer` to verify nothing was missed

**Real-world example**: Updated `record-session.md` in Claude to use `--mode record`, but forgot iFlow, Kilo, OpenCode, and Gemini — caught by cross-layer check.

---

## Generated Runtime Template Upgrade Consistency

Some generated files are both documentation and runtime input. In Trellis,
`.trellis/workflow.md` is parsed by `get_context.py`, `workflow_phase.py`,
SessionStart filters, and per-turn hooks. Template changes must be validated
against both fresh init and upgrade paths.

### Checklist: After Modifying A Runtime-Parsed Template

- [ ] Identify every runtime parser that reads the template, not just the file
  writer that installs it
- [ ] Check whether relevant syntax lives outside obvious managed regions
  such as tag blocks
- [ ] Verify fresh `init` output and a versioned `update` scenario that writes
  the older `.trellis/.version`
- [ ] Add an upgrade regression using an older pristine template fixture, then
  assert the installed file reaches the current packaged shape
- [ ] Update the backend spec that owns the runtime contract

**Real-world example**: Codex inline mode changed workflow platform markers from
`[Codex]` / `[Kilo, Antigravity, Windsurf]` to `[codex-sub-agent]` /
`[codex-inline, Kilo, Antigravity, Windsurf]`. Fresh init was correct, but
`trellis update` only merged `[workflow-state:*]` blocks and preserved stale
markers outside those blocks. Result: upgraded projects got new hook scripts
but old workflow routing, so `get_context.py --mode phase --platform codex`
could return empty Phase 2.1 detail.

---

## Mode-Detection Probe Checklist

When a CLI auto-detects a mode by probing a remote resource (e.g., checking if `index.json` exists to decide marketplace vs direct download):

### Before implementing:
- [ ] Probe runs in **ALL** code paths that use the result (interactive, `-y`, `--flag` combos)
- [ ] 404 vs transient error are distinguished — don't treat both as "not found"
- [ ] Transient errors **abort or retry**, never silently switch modes
- [ ] Shared state (caches, prefetched data) is **reset** when context changes (e.g., user switches source)
- [ ] **Shortcut paths** (e.g., `--template` skipping picker) must have the same error-handling quality as the probed path — check that downstream functions don't call catch-all wrappers

### After implementing:
- [ ] Trace every path from probe result to the mode-decision branch — no fallthrough
- [ ] External format contracts (giget URI, raw URLs) are tested or at least documented as comments
- [ ] Metadata reads consume a complete response or use a streaming parser — never parse a fixed-size prefix as full JSON
- [ ] When reconstructing a composite identifier from parsed parts, verify **all** fields are included and in the **correct position** (e.g., `provider:repo/path#ref` not `provider:repo#ref/path`)
- [ ] Verify that **action functions** called after a shortcut don't internally use the old catch-all fetch — they must use the probe-quality variant when error distinction matters

**Real-world example**: Custom registry flow had 8 bugs across 3 review rounds: (1) probe only ran in interactive mode, (2) transient errors fell through to wrong mode, (3) giget URI had `#ref` in wrong position, (4) prefetched templates leaked across source switches, (5) `--template` shortcut bypassed probe but `downloadTemplateById` internally used catch-all `fetchTemplateIndex`, turning timeouts into "Template not found".

**Real-world example**: Agent-session update hints fetched npm `latest` metadata with `response.read(4096)` and then parsed it as complete JSON. The `@mindfoldhq/trellis` package metadata exceeded 4 KB, so the JSON was truncated, parse failed silently, and the first session injection showed no update hint. Fix: read the complete response before parsing, and add a regression where `version` is followed by an 8 KB metadata tail.

---

## When to Create Flow Documentation

Create detailed flow docs when:

- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before

---

## Visible Snapshot Capability Lifetime

When a UI renders rows backed by opaque Main-owned capabilities, the displayed
snapshot and those capabilities form one cross-layer contract.

### Checklist

- [ ] If Renderer keeps prior rows visible during `loading`, Main keeps their
      selection capabilities resolvable until replacement rows are delivered.
- [ ] Background refresh invalidates pagination cursors immediately, but does
      not revoke an unchanged selection merely because the cache version or an
      observation timestamp changed.
- [ ] A refreshed row reuses an opaque selection only after Main matches its
      canonical resource identity and immutable header identity.
- [ ] Selection-time validation reads current state and permits only the source's
      documented monotonic mutation, such as append-only JSONL growth.
- [ ] First-launch tests click once while initialization and refresh overlap;
      they assert the selected resource opens without an automatic retry.

**Real-world example**: PiPilot retained session rows in the sidebar while a
startup catalog refresh set them to `loading`, but Main deleted the cache and
selection tokens immediately. The first click therefore used a token for a row
that was still visible but already revoked; after refresh, the second click used
the new token and succeeded. The fix retained the previous cache for selection,
reused tokens for the same canonical file/device/inode/header, allowed validated
append-only JSONL growth, and added a delayed-start Electron regression that
clicks exactly once.

### Checklist: Correlating Async Activation Completion

- [ ] Do not treat a newer global version/generation as proof that a specific
      user operation completed.
- [ ] Keep the UI pending until the authoritative boundary returns an identity
      for that operation, then accept only state carrying the same identity.
      For project-owned sessions the identity is the full
      `{ scopeKey, generation, sessionId }` tuple, not only process/session IDs.
- [ ] Give every overlapping operation its own sequence/identity; late success,
      error, and cleanup from an older operation must not settle the current one.
- [ ] On unmount/HMR, clear refs and resolve waiters without invoking setState.
- [ ] Test cold-start overlap where an unrelated operation completes first, and
      assert the UI never passes through an empty or stale presentation.

**Real-world example**: PiPilot originally ended Session loading when it saw any
runtime generation newer than the click-time generation. A cold-start default Pi
generation could satisfy that condition before `sessionCatalog.open` returned;
the real replacement then cleared the active session and exposed an empty frame.
The fix waits for Main's exact `{ scope, generation, sessionId }` activation
result and hydrates only that target.

### Checklist: Per-Runtime Generations And Session-Changing Responses

- [ ] Treat a Runtime generation as monotonic only within its own Runtime ID;
      never compare the numeric generation from one selected Runtime with the
      generation from another selected Runtime.
- [ ] For `new_session`, `switch_session`, `fork`, `clone`, and other
      session-changing commands, allow the selected Runtime snapshot to publish
      its new generation before the command response resolves. That transition
      is part of the successful response path, not proof of a stale response.
- [ ] Keep strict source-generation checks for commands that do not change the
      active Session, and keep the full `{ scopeKey, generation, sessionId }`
      target check for the resulting hydration.
- [ ] When a response carries renderer state such as a Fork draft, defer
      applying it until the new Session's exact hydration is ready; discard it
      on scope supersession or terminal failure.
- [ ] Test both directions: a higher-generation Runtime followed by a lower-
      generation Runtime selection, and a session-changing response whose new
      generation event arrives before its IPC response.

**Real-world example**: PiPilot rejected a successful Fork because the runtime
snapshot for the forked Session arrived before the `fork` command response. The
provider compared the new generation with the source generation and returned
early, so the Session opened but the official returned Composer draft was
lost. The fix treats session-changing transitions as authoritative, then waits
for exact new-session hydration before applying the draft.

### Checklist: Scope Is Part Of Hydration Identity

- [ ] Key hydration caches and in-flight request guards by scope, process
      generation, and official session ID together.
- [ ] If the active scope changes before the runtime event arrives, invalidate
      the old request even when generation/session values are coincidentally
      equal.
- [ ] Re-run authoritative state/message/model/command/stat hydration after the
      scope changes; do not let an old cache key suppress it.
- [ ] Commit async results only when the current scope, generation, and session
      all match the captured target.
- [ ] Test one project switch where the runtime snapshot arrives before the
      workspace scope update and prove loading reaches ready without a second
      click.

**Real-world example**: PiPilot keyed hydration by only
`{ generation, sessionId }`. During a project Session switch the runtime event
could arrive before the Workspace store changed scopes. The old-scope refresh
was then cancelled, but the new scope reused the same generation/session cache
key and never started another refresh, leaving the conversation spinner active
forever. The fix makes scope part of the hydration snapshot, cache key, response
guards, activation waiter, and presentation discriminator.

### Checklist: Activation Must Not Wait On Background Refresh

When Main has confirmed a user-selected conversation, the activation result is
the authoritative handoff from the session boundary to the renderer. Return
that identity before awaiting secondary catalog, file-tree, git-change, or
metadata refreshes. Those refreshes may be slow, superseded, or temporarily
unavailable and must not keep the conversation in an indefinite loading state.

- [ ] Apply the confirmed activation to the workspace state immediately.
- [ ] Let PiRpc hydrate the exact `{ scopeKey, generation, sessionId }` target
      independently.
- [ ] Run catalog/content refreshes as background work with stale-request
      guards and bounded error reporting.
- [ ] Keep blocking waits only for operations required to confirm the runtime
      identity itself (for example, `sessionCatalog.open`).
- [ ] Add an Electron regression that clicks a session once while a secondary
      refresh is delayed and asserts loading eventually becomes ready.

**Real-world example**: `WorkspaceStore.openSession` awaited
`refreshConversation` after Main had already returned a confirmed activation.
A delayed catalog/runtime refresh therefore prevented `App` from receiving the
activation, leaving the UI spinning even though Pi had opened the session.
The fix returns activation immediately and starts the refresh in the background.

### Checklist: Executable Wrappers Are Shared Cross-Layer Identity

When one selected executable drives both process startup and package discovery,
the wrapper-to-package relationship is one contract rather than two heuristics.

- [ ] Prove wrapper identity from bounded content and canonical targets, not a
      filename or installation-path guess.
- [ ] Reuse the same proof for spawn escaping and package-root discovery.
- [ ] Keep arbitrary wrappers usable for ordinary chat only when the normal
      runtime path supports them; never grant package-management authority from
      an unproven target.
- [ ] Test the real version-manager topology and shell metacharacters that cross
      nested parsers.
- [ ] Assert dependent outcomes at the UI boundary: exact child-observed argv,
      first-click transcript hydration, and package/resources availability.

**Real-world example**: PiPilot originally recognized npm Windows shims only by
`node_modules/.bin`. An fnm global npm `pi.cmd` could start simple RPC commands,
but selected Session paths crossed a second `cmd.exe` parser without the npm
shim escaping layer, while Integrations independently failed to find the
underlying importable package. The fix validates the npm-generated scaffold and
its `%dp0%`-relative target once, then shares that proof across spawn and package
location while keeping unknown batch wrappers fail-closed.

---

## External Operation Attribution Boundary

A received cross-process mutation receipt is ownership, not acceptance or
completion. When one operation crosses stdio, a local bridge, Main, a Runtime
Host, SDK queues, and projected UI/audit state:

- [ ] Reserve idempotency and return the opaque operation receipt before slow
      target acquisition, but never claim acceptance from a later event.
- [ ] Subscribe to exact target events and bind the Runtime lease before
      dispatch so immediate SDK events cannot beat observer setup.
- [ ] Buffer only bounded attribution events before acceptance; never retain raw
      tool arguments/results as correlation evidence.
- [ ] Correlate by the full owner tuple plus acceptance order and authoritative
      queue/user/settled boundaries. Do not complete on `turn_end` or text alone.
- [ ] Treat the next authoritative user entry as the boundary between queued
      accepted operations; the final operation completes at the exact settled
      boundary.
- [ ] Keep private correlation text only until its authoritative anchor matches,
      then clear text and hash immediately. Transformed/ambiguous text fails
      closed rather than borrowing another operation's response.
- [ ] Make disconnect cancellation local to the waiting request. It must not
      abort accepted work or another client's operation.
- [ ] Project Renderer/audit rows from metadata-only Main DTOs and compare
      revision/generation before applying asynchronous responses.

**Real-world example**: PiPilot External Control originally pre-anchored Steer
because it assumed Pi emitted no user entry. The actual SDK sequence was queue
update, queue delivery, authoritative user entry, assistant output, then
settlement. Completing at the user entry lost the assistant response. The fix
anchors Prompt, Follow-up, and Steer through authoritative queue/user boundaries
in acceptance order and completes only on the exact settled boundary.

---

## Event Log / Projection Boundary

Append-only logs are cross-layer contracts. A single event travels through:

```
CLI input → event writer → events.jsonl → reader → filter → reducer → display
```

### Checklist: After Adding A New Event Kind Or Field

- [ ] Add the event kind to the central event taxonomy
- [ ] Add a typed event variant or type guard at the event layer
- [ ] Add normalization helpers for array/object fields that come from
      user input or JSON
- [ ] Keep `seq` / `id` assignment in the event writer only
- [ ] Make filters and reducers consume the typed event guard, not local casts
- [ ] Make display code consume reducer output or typed events, not raw JSON
- [ ] Add at least one regression that proves history replay and live filtering
      use the same filter model

**Real-world example**: Thread channels added `kind: "thread"`, `description`,
`context`, labels, and `lastSeq`. The first implementation replayed thread
state correctly, but several commands still re-parsed event payload fields with
local casts. The fix was to make the core event layer own `ThreadChannelEvent`
and `isThreadEvent`, make `reduceChannelMetadata` the only channel metadata
projection, and make `reduceThreads` the only thread replay reducer.
