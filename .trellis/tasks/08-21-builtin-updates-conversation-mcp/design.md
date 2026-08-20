# Technical Design

> **Current implementation note (2026-08-22):** The Vite 8 lane passed and is
> retained at electron-vite `6.0.0-beta.1`, Vite `8.2.2`, and
> `@vitejs/plugin-react@6.1.0`. References below to electron-vite 5/Vite 7 are
> the documented fail-safe contingency, not the final selected worktree.

## 1. Design invariants

This task has three release-coupled but separately diagnosable deliverables:

1. update every direct dependency and every Pi package PiPilot bundles,
   manages, or exact-version adapts;
2. add a local, opt-in MCP control plane for exact PiPilot conversations;
3. synchronize every project-owned current document with the final verified
   source, package, workflow, platform, and test state.

The implementation must preserve these invariants:

- Main remains the only authority for workspaces, catalog targets, Hosts,
  Runtimes, operation ordering, credentials, and application lifecycle.
- Renderer IPC is not an external automation API.
- Listing persisted conversations is bounded read-only catalog work and never
  allocates a Host or Runtime.
- A background MCP operation never changes the selected desktop conversation.
- One Runtime generation owns one ordered submission lane for desktop and MCP
  callers. Accepted work is never replayed after replacement or restart.
- External control is disabled by default, local-current-user only, and exposes
  no transcript history, raw Session data, paths, prompt content, credentials,
  tool arguments, or extension-private state.
- Dependency migration failures stay attributable to one migration lane; tests
  and behavior are not weakened to retain an incompatible latest version.
- Current documentation never presents a planned feature as shipped or an old
  phase snapshot as the current architecture. Historical evidence is preserved
  and labeled rather than rewritten.

The deliverables remain one Trellis task because they share `package.json`, the
lockfile, Main bootstrap, packaging inputs, platform smoke gates, and final
release evidence. The implementation plan keeps each lane reversible before
the combined gate instead of creating child tasks that would concurrently edit
the same ownership boundaries.

## 2. Dependency migration lanes

Implementation re-runs authoritative registry resolution before editing the
lockfile. The versions in research are evidence from 2026-08-21, not permission
to assume a stale version remains latest.

| Lane | Planned change | Isolation / rollback point |
| --- | --- | --- |
| Patch application/tooling | Electron, Vitest, `react-resizable-panels`, `@types/node` | Update independently; run focused types/tests/build before combining. |
| Tiptap family | Move every Tiptap package to one exact release line | Never mix Tiptap minor versions; exercise Composer, mention, Skill, clipboard, and IME paths. |
| Pi ecosystem | Keep bundled Pi at registry latest; update Plan/Goal exact adapter metadata and verify latest managed/user packages | Preserve current ownership. Only `pi-mcp-adapter` remains automatically managed. |
| Vite build lane | Try electron-vite 6 beta + Vite 8 + plugin-react 6 | Keep only after the complete strict gate. Otherwise revert all three to the newest stable-compatible electron-vite 5/Vite 7/plugin-react 5 set and record the upstream failure. |
| MCP SDK | Add the official split `@modelcontextprotocol/server` package | Use only its public server and stdio exports; no deprecated monolithic SDK. |

Every dependency lane must leave a coherent `pnpm-lock.yaml`. The final direct
dependency inventory may contain only a documented Vite stable fallback; all
other outdated direct dependencies are release blockers.

## 3. Process architecture

```text
MCP client (Codex / Claude Code / other standard client)
       |
       | stdio MCP JSON-RPC (stdout is protocol-only)
       v
PiPilot executable --pipilot-mcp-stdio --descriptor <stable locator>
       |
       | versioned, authenticated, length-prefixed local bridge
       v
PiPilot GUI Main
  ConversationMcpBridgeServer
       |
  ConversationMcpControlService
       +-- WorkspaceRepository
       +-- OfficialPiSessionCatalog Main-only control targets
       +-- PiRuntimeFrontend / ProjectHostPool
       +-- ConversationMcpOperationRegistry
       +-- ConversationMcpAuditRepository
```

The packaged application Main entry becomes a small bootstrap. It examines the
dedicated headless flag before importing GUI startup code or acquiring the
single-instance lock:

- normal invocation dynamically imports the existing GUI Main module;
- `--pipilot-mcp-stdio` dynamically imports the stdio MCP entry and never
  creates a BrowserWindow, tray, Renderer, or second Runtime pool.

The stdio entry is a client of the already-running GUI Main bridge. It is not a
second PiPilot control authority and cannot operate when the GUI bridge is
disabled or unavailable.

### Packaged command resolution

The renderer receives a bounded copyable MCP configuration containing only a
stable packaged executable command, the headless flag, and a stable descriptor
locator path:

- macOS and installed Linux use the validated packaged executable. Windows
  packages a `PiPilot-mcp.exe` copy of the Electron binary, passes the ASAR main
  entry, and sets `ELECTRON_RUN_AS_NODE=1` in the standard MCP environment so
  the launcher runs the bootstrap as a real Node stdio process;
- AppImage uses the validated absolute `APPIMAGE` path, never a temporary mount
  path or an inner-ASAR script;
- development/unpackaged builds report configuration unavailable unless a
  test-only injected executable is provided.

The descriptor locator is stable across GUI restarts. Its contents are replaced
for every enabled app instance and are readable only by the current user. The
copied client configuration does not contain the bridge token.

### macOS packaged flow

On macOS the Settings copy action derives the executable from the running
packaged `process.execPath`, which normally resolves inside
`PiPilot.app/Contents/MacOS/`. It must not hardcode `/Applications`, a user
name, an ASAR path, or an `open -a` LaunchServices command. Moving the `.app`
requires copying the regenerated configuration from the moved application;
ordinary GUI restarts do not.

The direct executable parses `--pipilot-mcp-stdio` before importing GUI startup
or calling `app.requestSingleInstanceLock()`. In this branch macOS uses
Electron's headless/prohibited activation policy before readiness and never
creates a BrowserWindow, application menu, tray, Dock presence, Renderer, or Pi
Runtime pool. It never calls the normal GUI `app.dock.show()`/`hide()` paths.
This is a stdio child process owned by the MCP client, not a second PiPilot app
instance and not a GUI auto-launch mechanism.

The client-facing side remains standard MCP over stdin/stdout. Internally that
process reads the stable descriptor and connects through Node/Electron `net` to
a random Unix-domain socket in a short `0700` directory; the listening socket
and descriptor are `0600`. There is no TCP port, firewall prompt, browser
transport, Keychain, or `safeStorage` access. Several stdio clients may connect
to the same GUI bridge up to the shared client limit. A GUI restart disconnects
existing clients and rotates endpoint/token state, but a newly launched stdio
client uses the same descriptor locator and therefore the copied configuration
remains valid. A stopped GUI, disabled feature, missing descriptor, or stale
instance returns one bounded MCP error and exits without opening PiPilot.

## 4. Shared contracts and limits

Create one shared contract module for MCP-facing DTOs, bridge envelopes, tool
schemas, enums, error codes, settings snapshots, and audit rows. All recursive
or untrusted data is parsed at its process boundary.

Initial limits:

| Boundary | Limit |
| --- | ---: |
| Conversation page | 50 rows |
| Bridge frame / MCP result envelope | 1 MiB UTF-8 |
| Submitted prompt | 128 KiB UTF-8 |
| Final assistant response | 64 KiB UTF-8 |
| Idempotency key | 128 characters |
| In-memory operation records | 256 |
| Operation/idempotency retention | 24 hours or app shutdown, whichever is earlier |
| One `wait_for_turn` call | 30 seconds |
| Recent Settings/audit rows | 50 |
| Connected clients | 16 |
| In-flight bridge requests per client | 32 |

Bridge transport uses a four-byte big-endian length followed by one UTF-8 JSON
document. Oversized, malformed, unauthenticated, stale-protocol, duplicate-ID,
and over-concurrency frames close or reject only that client. Raw `Error`, SDK,
Electron, stream, class, callback, filesystem target, or catalog token values
never cross the bridge.

Stable public error codes include at least:

- `external_control_disabled`
- `pipilot_unavailable`
- `authentication_failed`
- `protocol_mismatch`
- `conversation_not_found`
- `conversation_unavailable`
- `invalid_state`
- `request_too_large`
- `idempotency_conflict`
- `interaction_required`
- `runtime_replaced`
- `operation_not_found`
- `deadline_exceeded`
- `internal_error`

Messages are bounded and sanitized. Internal stacks and absolute paths are
logged only through the existing private diagnostics policy, never returned to
an MCP client.

## 5. Conversation identity and inventory

Catalog selection tokens are short-lived UI capabilities and are never MCP
identities. Main persists a random 256-bit installation identity key in a
current-user-only file and derives:

```text
conv_<base64url(HMAC-SHA256(
  identityKey,
  protocolVersion | scopeKey | canonicalSessionFile
))>
```

The key is separate from the ephemeral bridge credential. Disabling External
Control rotates bridge authentication without renaming conversations. A copied
or moved Session intentionally receives a different conversation ID because
its canonical file/scope identity changed.

`OfficialPiSessionCatalog` gains a Main-only control-target view. It reuses the
existing bounded cache, scope/header validation, direct-file rules, and
canonical revalidation, but returns the canonical target only to Main. It does
not expose selection tokens or paths to the MCP layer.

`list_conversations` merges:

1. projectless scope plus all saved workspaces from `WorkspaceRepository`;
2. every bounded official catalog row available for those scopes;
3. retained Runtime summaries/activity from the existing Main Runtime owner.

A catalog row without a Runtime is `inactive`. An unobserved catalog scope is
reported as `not_loaded`; inventory does not guess Pi directory encoding or scan
arbitrary files. Read calls cannot start Hosts/Runtimes or alter desktop state.

Public lifecycle is normalized to:

```text
inactive | idle | accepting | running | queued | stopped | crashed | unavailable
```

Optional bounded activity identifies prompt/tool/retry/compaction/
summarization/interaction work without exposing content. Metadata may include
the user-visible conversation name, project label, timestamps, queue counts,
and non-secret model identity.

List cursors are opaque, Main-authenticated, and tied to an inventory revision.
A stale cursor returns a stable error and never changes inventory state.

## 6. Background Runtime ownership

Do not create a second Runtime cache. Extend the existing Main
`PiRuntimeFrontend` ownership with Main-only operations that:

- find/reuse an exact retained Runtime for a canonical catalog target;
- acquire, bind, and hydrate an inactive target in its project Host without
  selecting it in the Renderer;
- return an exact handle containing scope, Session identity, Runtime ID, Host
  epoch, and Runtime generation;
- route commands only while all exact identity fields still match;
- fan out Main-only operation observations before issuing the existing single
  Host event acknowledgement;
- preserve existing idle-only LRU reclamation and pin every running, queued,
  retrying, compacting, summarizing, extension-interacting, or unpersisted
  Runtime.

Background acquisition is serialized with normal activation and session leases.
Failure disposes only a newly-created candidate. It does not evict a healthy
selected Runtime, change the catalog row, replay work, or synthesize success.

If an MCP-owned background Runtime requests blocking extension UI, Main cancels
that exact UI request and completes the MCP operation as `failed` with
`interaction_required`. It does not select the conversation or display an
unrelated modal. Non-blocking status/notification evidence remains internal to
the operation/audit projection.

## 7. Submission and operation state machine

### Atomic submission

Add a Host-internal external-submit command. It is not a Renderer-facing RPC
command. It runs inside the same ordered per-Runtime command lane as desktop
submission and accepts `auto | prompt | follow_up | steer`:

- `auto`: atomically inspect SDK state and send Prompt when idle or Follow-up
  when running;
- `prompt`: require the exact normal-Prompt state and Pi preflight acceptance;
- `follow_up`: call the public SDK follow-up method and require resolution;
- `steer`: call the public SDK steer method and require resolution.

A Main `get_state` followed by a separate command is forbidden because another
caller can change state between the two operations. Normal Prompt is accepted
only after `preflightResult(true)` (or the exact equivalent in the currently
pinned public SDK). Rejection creates no accepted state; it terminates the
already-received operation with a bounded failure instead.

### Public operation contract

`send_prompt` requires:

```text
conversationId, prompt, mode=auto, idempotencyKey
```

After authentication, schema validation, an existing opaque conversation-ID
lookup, and atomic idempotency reservation, it returns immediately:

```text
conversationId, operationId, requestedMode, status=received, receivedAt
```

External operation state is:

```text
received -> starting? -> accepting -> accepted -> completed
    |           |           |           |------> failed
    |           |           |           |------> aborted
    |           |           |           `------> runtime_replaced
    |           |           `------------------> terminal
    |           `------------------------------> terminal
    `------------------------------------------> terminal
```

Operation IDs are random opaque `op_` identities scoped to the current app
instance; they do not encode Runtime, Session, project, timestamp, or content.

The immediate MCP result proves only that PiPilot owns one idempotent operation.
It does not prove target revalidation, Runtime startup, queue insertion, or Pi
acceptance. `starting` is used while an inactive target is being acquired;
already-loaded targets may move directly from `received` to `accepting`.
`acceptedMode` and `acceptedAt` appear only after the Host's authoritative SDK
acceptance boundary. For `auto`, `requestedMode=auto` remains distinct from the
eventual `acceptedMode=prompt|follow_up`.

Authentication/schema failures, malformed or unknown opaque IDs, and an
idempotency conflict fail synchronously without creating an operation. Every
failure after the `received` response updates that same operation to a terminal
state; it is never returned as an unrelated second error or silently discarded.

`get_operation` returns the current state immediately. `wait_for_turn` accepts
`until=accepted|terminal`. Waiting for `accepted` returns on authoritative
acceptance or any earlier terminal; waiting for `terminal` returns only a
terminal. `timed_out` is only a wait result and never mutates the operation. A
completed send may include only the bounded visible final assistant response
attributable to that operation.

The operation registry is bounded in-memory state scoped to the current app
instance. Persistent audit stores metadata only. App shutdown invalidates old
operation IDs; received or accepted work is never replayed after restart.

### Attribution

Per Runtime, accepted MCP mutations are matched in acceptance order. Main holds
the submitted text privately only until it can match the corresponding
authoritative user entry or queue position, then discards it. It is never
returned, audited, or written to diagnostics.

- Prompt/Follow-up completion uses visible assistant text after the matched
  user/queue anchor and the exact settled boundary.
- Steer follows the same queue-hash to authoritative user-entry anchor as
  Follow-up. The current Pi SDK emits `queue_update`, then a delivered user
  `entry_appended`, assistant output, and `agent_settled`; it is not safe to
  pre-anchor Steer at acceptance or complete it on the queue event. Only the
  exact user boundary and later settled event may complete the operation.
- Host epoch, Runtime generation, Session replacement, ambiguous ordering, or
  missing authoritative evidence fails closed rather than returning another
  operation's response.

### Idempotency and abort

Every mutating tool requires a caller idempotency key. Main stores a normalized
request fingerprint. Repeating an identical request returns the original
operation; reusing the key for different input fails before dispatch.

`abort_conversation` uses the same immediate operation contract. A malformed,
unknown, or synchronously known inactive target fails without an operation;
otherwise it returns `received`, then becomes `accepted` only after the exact
SDK Runtime accepts the abort. The abort operation completes when that Runtime
reaches the corresponding settled/idle boundary. A stale/unavailable target
after receipt terminates the operation truthfully. It cannot abort a different
replacement generation.

## 8. MCP tools

The MVP exposes tools only:

| Tool | Request | Result |
| --- | --- | --- |
| `list_conversations` | optional opaque cursor/page size | bounded rows, next cursor, scope diagnostics |
| `get_conversation_status` | conversation ID | exact current metadata/lifecycle |
| `send_prompt` | ID, prompt, mode, idempotency key | immediate `received` operation identity/requested mode |
| `abort_conversation` | ID, idempotency key | immediate `received` abort operation |
| `get_operation` | operation ID | current operation state, bounded terminal result/error |
| `wait_for_turn` | operation ID, `until=accepted|terminal`, bounded timeout | reached state/terminal or non-terminal `timed_out` |

No MCP resource, subscription, transcript/history endpoint, generic Runtime
command, filesystem endpoint, or Renderer IPC proxy is registered.

## 9. Local authentication and lifecycle

`ConversationMcpBridgeServer` starts only when the persisted External Control
setting is enabled. It creates:

- a stable `0600` descriptor locator in PiPilot user data;
- a random per-app-instance endpoint;
- a random high-entropy bridge token;
- a random app instance ID and protocol version.

On macOS/Linux the endpoint is a Unix socket inside a short random `0700`
temporary directory and the socket is chmod `0600`. On Windows it is a random
named pipe plus token authentication; a native test must prove both descriptor/
identity-file current-user ownership and cross-user pipe denial or Windows
enablement fails closed. POSIX mode bits alone are not treated as Windows ACL
evidence.

The stdio process reads the descriptor, connects locally, and sends the token in
its first bridge frame. Token comparison is constant-time. The bridge permits
only the current protocol and app instance. Disabling External Control closes
clients, removes endpoint/descriptor state, rotates the token, and publishes a
disabled snapshot. Re-enabling never revives an old connection.

No TCP, HTTP, browser transport, Keychain, `safeStorage`, environment token, or
token-bearing copied config is used. The trust boundary is current-user local
process access plus an explicit PiPilot setting, not remote authentication.

Shutdown joins the existing application shutdown coordinator. Bridge clients
close before Runtime/Host disposal. A stdio process exits on stdin close,
protocol failure, disabled/stale descriptor, bridge disconnect, or bounded
idle/startup timeout. stdout is MCP JSON-RPC only; logs use stderr/private app
logging.

## 10. Settings UI

Add `external-control` to `IntegrationsTabId` and the existing compact internal
tab strip. Do not add a top-level navigation destination.

The page follows the confirmed PiPilot visual language and contains:

- explicit enable switch;
- disabled, enabling, ready, disabling, and inline error states;
- concise current-user/local-only explanation;
- connected-client count;
- copyable client configuration with Copy action and no credential;
- bounded recent-operation rows containing a Main-resolved conversation label
  when available, action, status, and timestamp only. The bridge handshake has
  no trusted client-label field, so the MVP does not fabricate or display one.

Do not render prompt/final-response content, raw IDs by default, filesystem
paths beyond the necessary copied command, nested cards, compatibility matrix,
marketing copy, or blocking success dialogs. If active clients exist, Disable
uses one concise destructive confirmation and then disconnects them. Ordinary
success is inline. All text enters both locale catalogs.

States are modeled before styling:

```text
disabled | enabling | ready | disabling | error | unavailable
```

The page must preserve keyboard navigation, visible focus, icon labels/tooltips,
light/dark themes, reduced motion, and the supported 1100x680 minimum without
horizontal document overflow.

## 11. Data flow

### List

```text
MCP tool -> stdio schema -> authenticated bridge request
  -> Main workspace/catalog inventory -> opaque ID/status projection
  -> bounded bridge response -> MCP tool result
```

No Runtime method occurs on this path.

### Send to inactive conversation

```text
send_prompt
  -> validate auth/schema/opaque identity
  -> reserve idempotency + operation(status=received)
  -> return operation ID immediately
  -> revalidate Main-only catalog control target
  -> operation(status=starting)
  -> acquire + hydrate background Runtime (no selection)
  -> operation(status=accepting)
  -> exact Host external-submit command
  -> authoritative acceptance
  -> operation(status=accepted, acceptedMode)
  -> observe exact Runtime events/entries
  -> terminal operation + optional bounded final response
```

### Wait

```text
wait_for_turn(until) -> read current operation
  -> requested milestone or terminal already reached: return immediately
  -> otherwise subscribe by operation ID for <=30s
  -> acceptance/terminal milestone: return exact current state
  -> deadline: return timed_out, leave operation unchanged
```

Client disconnect cancels only its active waits. It does not abort received or
accepted work, or another client's operation.

## 12. Failure matrix

| Failure | Required result |
| --- | --- |
| GUI not running / External Control disabled | stdio exits with bounded MCP error; no GUI auto-launch or Runtime mutation |
| Descriptor/token stale | authentication failure; old connection closed |
| Unknown/stale conversation ID | typed read/mutation error; no catalog selection or Runtime change |
| Inactive Runtime startup fails | received operation becomes failed; desktop selection unchanged |
| Runtime generation changes before acceptance | received operation becomes `runtime_replaced`; never accepted |
| Generation changes after acceptance | accepted operation terminates `runtime_replaced`; never replay |
| Blocking extension UI | exact operation `failed/interaction_required`; no unrelated dialog |
| Wait deadline | `timed_out`; operation remains accepted |
| Client disconnect | wait subscription removed; accepted work continues |
| Host crash | exact pending operations fail/replaced; sibling Hosts continue |
| Oversized/malformed frame | reject/close that client; Main remains available |
| Same idempotency key, different request | `idempotency_conflict`; no second mutation |
| Vite beta lane fails strict gate | restore complete stable Vite lane and record blocker |

## 13. Rollout and rollback

- External Control ships disabled and requires no migration of Pi Session data.
- New local state is limited to an installation identity key, enable setting,
  descriptor, and bounded metadata audit. Removing the feature deletes bridge
  state without touching conversations.
- The identity key and audit file are created atomically with current-user-only
  permissions. Invalid permissions or malformed state fail closed.
- Dependency lanes are committed only after their isolated gate. A failed lane
  is reverted as a complete family before proceeding.
- The MCP feature can be source-reverted independently of outbound Pi MCP
  settings; `~/.pi/agent/mcp.json` and project `.mcp.json` are not migration
  inputs.
- No publish or compatibility claim occurs until the combined unit,
  integration, real Electron, build, package, packaged-smoke, native-platform,
  and standard-client gates pass on the same worktree.

## 14. Documentation authority and drift control

Documentation is synchronized only after dependency, protocol, behavior, and
native evidence have stabilized. The final documentation pass uses four
classes:

| Class | Files | Required treatment |
| --- | --- | --- |
| Current public/product/developer authority | `README.md`, `README.zh-CN.md`, `PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/PACKAGING.md`, `docs/TEST_MATRIX.md`, new `docs/README.md` | Rewrite from final source/config/evidence; no historical counts or future claims. |
| Current engineering authority | affected `.trellis/spec/backend/**`, `.trellis/spec/frontend/**`, and reusable guides | Update executable contracts and current ownership; remove superseded patterns. |
| Historical snapshot | `docs/IMPLEMENTATION_PLAN.md`, `docs/COMPLETION_AUDIT.md`, `docs/PHASE_*_REPORT.md` | Preserve original facts; add one standard dated-history notice and links to current authorities. |
| Evidence/generated/vendor | archived tasks, active task research, workspace journals, test fixtures, generated reports, third-party/package docs, machine-local Skills/platform templates | Do not bulk rewrite; keep outside the current-document claim and generated package boundary. |

`docs/ARCHITECTURE.md` is rewritten as a concise current process/data/lifecycle
document rather than extending its obsolete phase-by-phase target narrative.
`docs/TEST_MATRIX.md` is regenerated from current scripts, test files, workflow
jobs, and commands that actually ran; it does not retain Phase 13 counts as
current evidence. `PRODUCT.md` describes the embedded pinned SDK and separates
outbound Pi MCP configuration from the new inbound PiPilot External Control
server. Packaging and both READMEs use the final versions, platform support,
manual/signing/update policy, and actual client configuration behavior.

The new `docs/README.md` is the navigation and authority boundary. Current docs
carry a verified-current status; historical docs carry the same visible
historical snapshot notice. Links are checked after any move or rename. English
and Chinese README headings, commands, capability lists, platform tables, and
security caveats are compared semantically rather than by line-for-line text.

Documentation verification includes targeted stale-term searches for old Pi
versions, former Agent Worker/single-Runtime ownership, obsolete test counts,
pre-release status, external Pi executable requirements, invalid MCP paths,
`open -a`, and claims unsupported by the final platform gate. Search hits in a
clearly labeled historical snapshot are allowed; hits in current authorities
are release blockers unless they explicitly describe migration history.
