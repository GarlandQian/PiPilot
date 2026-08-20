# Conversation MCP architecture research

## Scope and evidence

Checked against the current worktree on 2026-08-21. This is planning evidence;
no product code or dependency was changed.

Relevant current owners:

- `ProjectHostPool` is Main's exact Host/Runtime router. Commands require a
  `runtimeId` and may require an expected Runtime generation.
- `PiRuntimeFrontend` owns the Renderer-selected Runtime plus retained inactive
  Runtime activity, idle-only reclamation, Host event credit and hydration.
- `OfficialPiSessionCatalog` owns bounded official Session discovery and
  selection revalidation. Catalog rows do not allocate Runtimes.
- `WorkspaceRepository` owns the bounded saved-project inventory; Main can
  resolve each opaque workspace ID to its canonical cwd.
- `runtime-command-dispatcher` already proves normal Prompt acceptance through
  Pi's `preflightResult(true)` callback and exposes explicit Follow-up, Steer
  and Abort methods.
- Electron's `RunAsNode` fuse is enabled for the existing management helper,
  but an AppImage cannot expose a stable inner-ASAR script path to an external
  MCP client.

## Findings

### Do not expose Renderer IPC

Renderer IPC is scoped to the selected conversation and a trusted Electron
sender. Reusing it would couple external automation to window selection and
would make background operations vulnerable to the same selection/generation
replacement rules as the visible transcript. The external authority must be a
Main service composed over the Host pool, catalog and workspace repository.

### Do not use Session catalog selection tokens as external identities

Selection tokens are Main-owned capabilities tied to a rendered catalog
snapshot. Refresh, recovery and deletion deliberately invalidate or consume
them. An MCP client needs an opaque identity that survives refresh and app
restart.

Use a separately persisted 256-bit installation identity key and derive:

```text
conv_<base64url(HMAC-SHA256(key, version | scope-key | canonical-session-file))>
```

The filesystem path remains Main-only. The ID is stable while the same Session
file remains in the same scope, and intentionally changes if the file is moved
to a different scope/path. Header Session IDs alone are insufficient because a
Session file can be copied.

The catalog should expose a new Main-only control-target view that reuses the
existing cache and selection revalidation but returns the canonical target only
inside Main. The MCP DTO never receives a selection token or path.

### Catalog inventory and Runtime inventory are different

`list_conversations` must merge two sources without creating work:

1. projectless plus every available saved workspace scope;
2. every known official catalog row in those scopes;
3. current Host/Runtime summaries and tracked Runtime activity.

A catalog row with no Runtime is `inactive`. A scope whose official Session
directory has not yet been observed remains honestly `not_loaded`; the MCP
server must not guess Pi's directory encoding or recursively scan the disk.
Thus "every PiPilot conversation" means every conversation discoverable by the
same official catalog contract as the desktop sidebar, not arbitrary JSONL
files elsewhere on the machine.

### Background control should extend the existing Main Runtime owner

Creating a second Runtime cache/controller over `ProjectHostPool` would split
session leases, event credit, activity tracking and idle reclamation. Extend
`PiRuntimeFrontend` (or extract a shared Main Runtime registry from it) with
Main-only methods that:

- acquire or reuse an exact Session Runtime without selecting it;
- bind/hydrate a newly created background Runtime before returning a handle;
- route commands to an exact `{runtimeId, generation, scope, sessionFile}`;
- publish all tracked Runtime events to Main-only listeners before returning
  the single Host event credit;
- preserve the existing rule that executing, queued, retrying, compacting,
  summarizing or interaction-blocked Runtimes are never reclaimed.

The Renderer continues receiving only the selected Runtime projection.

### Receipt, Pi acceptance and completion are separate facts

`send_prompt` returns immediately after bounded synchronous validation and an
atomic operation/idempotency reservation. Its result is `received`; it is not a
claim that Pi accepted the prompt. Background target revalidation, Runtime
startup and SDK submission update that exact operation. For `auto`, the Host
must choose Prompt versus Follow-up at the same serialized SDK boundary that
performs the submission; a Main `get_state` followed by a separate command has
a race, and the immediate response cannot truthfully include `acceptedMode`.

Add a Host-internal external-submit command rather than a Renderer RPC command.
The operation transitions to `accepted` and records `acceptedMode` only after:

- normal Prompt: `preflightResult(true)`;
- Follow-up/Steer: the public SDK method resolves;
- rejection: a bounded typed terminal operation error, never an accepted state.

Completion is projected from exact Runtime/generation events and persisted
entries. The service keeps the accepted request text privately only while it is
needed to match the corresponding user entry/queue position. It never returns
that text over MCP or writes it to audit logs. Operations are serialized and
matched in acceptance order per Runtime; the final response is bounded visible
assistant text after the matched operation anchor. Steer, which does not create
a user entry, completes at the next exact settled boundary and uses only
assistant text observed after acceptance.

If an MCP-owned background operation invokes blocking extension UI, PiPilot
does not change the desktop selection or open a dialog for a different
conversation. Main resolves that exact UI request as cancelled and terminates
the MCP operation as `failed` with an `interaction_required` code. Other
Runtimes are unaffected.

### Local transport and authorization

Use two processes and two protocols:

```text
Codex / Claude / MCP client
          |
          | stdio MCP JSON-RPC
          v
PiPilot packaged --pipilot-mcp-stdio mode
          |
          | authenticated bounded local bridge
          v
running PiPilot Main -> conversation control service -> Runtime pool
```

The packaged application executable accepts a dedicated headless
`--pipilot-mcp-stdio` mode before GUI bootstrap and single-instance locking. A
small bootstrap entry dynamically imports either the stdio mode or the normal
GUI Main. This produces one stable command on macOS, Windows, deb and AppImage;
it avoids an inner-ASAR helper path that is unstable for AppImage.

The MCP mode receives only a descriptor-file path as an argument. The
descriptor is created by the running GUI process with mode `0600` and contains
a protocol version, random endpoint, app instance ID and random bridge token.
The token is never placed in copied client configuration or Renderer DTOs.

- macOS/Linux: random Unix socket inside a per-instance `0700` temporary
  directory; chmod the listening socket to `0600`.
- Windows: random named pipe plus the same high-entropy token. A native runner
  must prove another user cannot connect; otherwise Windows enablement fails
  closed rather than claiming user-only isolation.
- no TCP listener, remote bind, browser transport or Keychain/safeStorage.
- enabling External Control starts the bridge; disabling closes clients,
  removes the descriptor/socket and rotates the credential.
- the persistent installation identity key used for opaque conversation IDs is
  separate from the ephemeral bridge credential, so disabling access does not
  rename every conversation.

The stdio process reserves stdout for MCP JSON-RPC and sends logs only to
stderr. It exits cleanly when stdin closes or the bridge rejects/vanishes.

#### macOS process behavior

On macOS, stdio and the Unix socket serve different boundaries. Codex, Claude
Code, or another MCP client speaks standard MCP JSON-RPC to the child process
over stdin/stdout. That child connects privately to the running PiPilot Main
through a Unix-domain socket; clients never configure the socket themselves.

The copied command must use the exact packaged executable derived from the
running app (`process.execPath`, normally under
`PiPilot.app/Contents/MacOS/PiPilot`) with `--pipilot-mcp-stdio`. It must not use
`open -a`, because LaunchServices would activate the GUI application and would
not provide a clean protocol-only stdout lifecycle. It must not reference an
inner ASAR script or assume the app lives in `/Applications`.

The headless branch is selected before the current GUI Main calls
`app.requestSingleInstanceLock()`. Electron 43's installed types expose
`app.setActivationPolicy('prohibited')`; the implementation must use a proven
headless activation path before readiness and must not create a BrowserWindow,
application menu, tray, Dock presence, Renderer, or Runtime pool. This prevents
the MCP proxy from appearing as a second desktop app while leaving the normal
tray-resident GUI lifecycle unchanged.

The GUI writes a stable descriptor locator under its user-data ownership, but
the random UDS endpoint and token rotate on enable/restart. The socket lives in
a short random `0700` directory and the socket/descriptor are `0600`. Existing
clients exit when the GUI bridge disappears; client supervisors may launch a
new stdio process using the unchanged descriptor path after restart. Moving the
`.app` changes `process.execPath`, so the user must copy the regenerated command
from the moved app. There is no listening TCP port, firewall prompt, Keychain,
or `safeStorage` access. If the GUI is stopped or control is disabled, the
proxy returns a bounded unavailable error and exits without auto-launching it.

These are design requirements, not current-worktree claims. Native packaged
macOS tests must prove the visible-process, permission, restart, and failure
behavior before the documentation calls the feature supported.

### MCP surface

MVP tools only; no resources, subscriptions or arbitrary transcript reads:

| Tool | Purpose |
| --- | --- |
| `list_conversations` | Paginated metadata/status for known conversations and bounded scope diagnostics. |
| `get_conversation_status` | Current exact state for one opaque conversation ID. |
| `send_prompt` | Submit `auto|prompt|follow_up|steer`; immediately return one idempotent `received` operation. |
| `abort_conversation` | Immediately create a received operation that may abort only the exact target Runtime. |
| `get_operation` | Poll receipt/startup/acceptance/terminal state. |
| `wait_for_turn` | Bounded long-poll until authoritative acceptance or terminal state; timeout is non-terminal. |

Read DTOs may contain conversation name, project label, timestamps, lifecycle,
queue counts and non-secret model identity. They omit preview text, prompts,
thinking, tool arguments/results, paths, environment, credentials and raw
errors. Operation completion may contain at most the visible final assistant
text produced by that operation.

### Bounds and state

Initial implementation limits (central shared constants, adjustable only with
tests):

- list page: 50 conversations; request/response envelope: 1 MiB;
- submitted prompt: 128 KiB UTF-8; final response: 64 KiB UTF-8;
- idempotency key: 128 characters; operation registry: 256 records;
- operation/idempotency retention: 24 hours;
- `wait_for_turn`: at most 30 seconds per call; callers may repeat;
- recent UI/audit rows: 50; audit file rotates at a bounded size and contains
  no prompt/response content.

Operation progress is `received`, optional `starting`, `accepting`, then
`accepted`. Terminals are `completed`, `failed`, `aborted`, and
`runtime_replaced`; a pre-acceptance operation may enter a terminal directly.
`timed_out` is a wait result, never stored as a terminal. Every record captures
exact scope, Runtime ID, generation and Session identity as those facts become
available. A Host restart or Runtime generation replacement terminates affected
pending operations as `runtime_replaced`; PiPilot never replays a received or
accepted mutation.

Mutating tools require an idempotency key. The service stores the normalized
request fingerprint: an identical replay returns the original operation,
whereas a different request with the same key is rejected before dispatch.

## UI fit

Add an `External control` tab inside the existing Integrations workspace. Keep
the current compact header/tab rhythm from the confirmed Integrations visual
baseline. The page contains:

- one explicit enable switch with honest disabled/loading/ready/error states;
- local-only/security copy and connected-client count;
- a bounded command/arguments configuration block with Copy, never the token;
- a compact recent-operation list with conversation label, action, status and
  timestamp, but no prompt or response content.

Do not add a top-level navigation item, nested cards, a compatibility matrix,
marketing copy or a blocking success dialog. Disable errors are inline;
destructive disconnect uses concise confirmation only if active clients exist.

## Risks and required proof

- Background events currently receive one Host credit through
  `PiRuntimeFrontend`; adding a second independent acknowledger can over-credit
  the stream. Main-only event consumers must be fanned out before the existing
  single acknowledgement.
- Same-Runtime Renderer and MCP submissions need one ordered operation lane.
- Unix socket path limits require a short temporary directory, not an arbitrary
  deep userData path.
- AppImage requires the packaged app-executable mode; an inner-ASAR Node helper
  command is not stable.
- Windows named-pipe current-user isolation needs a native test.
- Exact final-response attribution under mixed queued prompts needs unit,
  integration and real SDK Electron tests; ambiguity must fail closed rather
  than return another prompt's response.
