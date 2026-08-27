# PiPilot Architecture

Status: current authority, verified against the `0.0.1` worktree on 2026-08-22.
For document ownership and historical reports, see [the documentation index](README.md).

## Product Boundary

PiPilot is an Electron desktop application. It embeds the exact
`@earendil-works/pi-coding-agent@0.84.2` dependency and runs Pi SDK objects in
supervised Electron utility processes. Pi remains the owner of Session JSONL,
Pi configuration, models, packages, extensions, Skills, and agent semantics;
PiPilot owns the desktop projection, process lifecycle, bounded IPC, and
Main-owned catalog/runtime coordination. A separate inbound External Control
MCP surface is opt-in and local-only.

The application has no web deployment, TCP MCP listener, Renderer access to
Node.js, CLI/JSONL runtime fallback, or separate user-installed Pi executable.

## Process Topology

```text
Electron BrowserWindow
  React Renderer
      | sandboxed preload, allowlisted validated IPC
Electron Main
  settings/catalog/workspace/config services
  ProjectHostPool -> one utility process per canonical project/projectless cwd
      | MessagePort, structured-clone bounded DTOs
  PiRuntimeFrontend -> retained Runtime/session identities
      | official Pi SDK 0.84.2
  external-control lifecycle -> bridge server -> operation/control services

Packaged MCP stdio process
  MCP JSON-RPC on stdout only
  authenticated local bridge client -> Main bridge (Unix socket/named pipe)
```

Main creates long-lived repositories and services. Preload exposes only typed
facades. Renderer adapters/stores subscribe to snapshots and never import
Electron, Node, filesystem, SDK classes, or raw IPC primitives.

## Runtime Ownership

`ProjectHostPool` owns Host epochs and exact Runtime descriptors. A Runtime is
identified by `{ runtimeId, generation, scope, sessionId, sessionFile }`; the
numeric generation is meaningful only within its Runtime ID. The selected
Runtime is a Renderer projection, not an ownership transfer. Commands capture
their exact identity and remain bound to it while the user changes selection.

Every Runtime uses the official SDK through a structured-clone MessagePort
protocol. Envelopes carry protocol version, Host epoch, Runtime ID/generation,
request identity, sequence/credit, and bounded payload metadata. Raw SDK
objects, streams, callbacks, extension components, secrets, and filesystem
paths do not cross process boundaries.

Hosts are scoped to a canonical project cwd or the fixed projectless cwd.
Runtimes have no artificial numeric capacity. Persisted idle Runtimes may be
reclaimed by a bounded per-Host LRU only after authoritative idle validation;
running, queued, retrying, compacting, summarizing, extension-interacting,
unpersisted, pinned, or externally acquired Runtimes are retained. Control
leases/pins are released in `finally` paths and participate in idle reclamation.

Host crash or an exact missing Runtime is terminal for affected operations and
does not evict healthy sibling Runtimes. Controlled activation/replacement
transactions can temporarily omit a candidate Runtime without synthesizing a
crash. Runtime/session identity and generation are revalidated before every
external command dispatch.

## Official Session Catalog

`OfficialPiSessionCatalog` is bounded, read-only navigation metadata. It learns
Pi's actual Session directory from SDK state; it never guesses Pi's cwd
encoding, recursively scans arbitrary directories, or exposes a path to the
Renderer or MCP. Project and projectless scopes are resolved through
`WorkspaceRepository`; direct v3 Session headers are checked against the
canonical scope cwd. Catalog listing/paging never starts a Host or Runtime.

Renderer selection tokens are process-local UI capabilities. External Control
uses a separate installation-key-derived opaque `conv_...` identity bound to
scope and canonical Session identity. Main revalidates the target immediately
before acquiring a retained/background Runtime. Inventory rows without a
Runtime are `inactive`; unobserved scopes are reported as `not_loaded` rather
than guessed.

## External Control MCP

External Control is disabled by default and enabled through the existing
Settings > Integrations internal tab. Enabling creates a stable current-user
descriptor locator, a per-app-instance endpoint, a random capability token,
and a protocol/instance identity. The copied client configuration is the
portable server entry `{ command: "pipilot-mcp", args: [] }`; it never contains
the token, packaged executable, descriptor path, or platform-specific flags.

On macOS/Linux, the bridge endpoint is a `0600` Unix socket inside a random
`0700` directory. On Windows, it is a random named pipe with current-user
access requirements. The bridge uses a four-byte big-endian length-prefixed
JSON frame, versioned hello/ack authentication, constant-time token matching,
request/result schemas, a 1 MiB frame bound, 32 in-flight requests/client,
16-client socket capacity, handshake timeout, and bounded request deadlines.
Unauthenticated sockets count toward transport capacity but not the Settings
authenticated-client count.

Main owns an explicit install/repair/uninstall service for the stable launcher.
On macOS/Linux it writes an atomically replaced, receipt-bound wrapper only
into a secure stable user directory already present in `PATH`. Removal requires
the current no-follow file identity and private receipt to match, rechecks both
before unlinking, and restores the owned wrapper if receipt cleanup fails. On
Windows it keeps the packaged CUI copy named `pipilot-mcp.exe` beside the
application and registers that directory in the current user's PATH without
rebuilding unrelated PATH content. Removal keeps the executable and deletes
only the single receipt-proven PATH entry. Windows PATH persistence uses a fixed
absolute `reg.exe` with private, bounded UTF-16 registry export/import files,
exact read-back, and verified rollback; it does not parse locale-dependent
command output. An unowned or ambiguous launcher fails closed. The private
launcher supplies
`--pipilot-mcp-stdio` and the absolute
descriptor internally; these values never cross Shared, preload, or Renderer.
Headless bootstrap imports the MCP module without GUI creation, sets macOS
activation policy to `prohibited`, injects the packaged version into MCP
serverInfo, and exits through `app.exit(code)` on all platforms. Stdout is
exclusively MCP JSON-RPC; bounded unavailable/startup errors go to stderr and
exit nonzero. It never opens a BrowserWindow, TCP listener, Keychain capability
token, or Renderer IPC.

The tool-only MVP exposes exactly six methods:

| Method | Contract |
| --- | --- |
| `list_conversations` | bounded metadata page, opaque IDs, scope diagnostics |
| `get_conversation_status` | exact lifecycle/metadata for one opaque ID |
| `send_prompt` | idempotent `received` receipt; later authoritative acceptance |
| `abort_conversation` | explicit idempotent abort receipt |
| `get_operation` | current bounded operation state/result |
| `wait_for_turn` | wait for `accepted` or terminal, bounded timeout |

Operations are tracked as `received -> starting -> accepting -> accepted ->
completed|failed|aborted|runtime_replaced`. Authentication, schema, unknown
identity, and idempotency conflicts fail synchronously without an operation.
Prompt text is private Main memory only until an exact authoritative queue/user
anchor is matched, then discarded. Event attribution uses Runtime ID,
generation, Session identity, acceptance order, authoritative user boundaries,
and exact settled events; ambiguity fails closed. Only the bounded final
assistant response belonging to that operation may be returned.

Background acquisition binds an exact catalog target without changing the
desktop selection. Blocking extension UI for a background operation is
cancelled as `interaction_required`. Client disconnect cancels only waits;
accepted work continues. Disable closes clients before control disposal, removes
the descriptor/socket state, and invalidates the previous credential. Shutdown
closes the bridge before releasing Runtime control leases.

## Settings Projection

The renderer uses `src/store/external-control.tsx` for a monotonic,
revision-checked snapshot. The existing Integrations tab renders
`disabled | enabling | ready | disabling | error | unavailable`, authenticated
client count, token-free command configuration, and bounded metadata-only
recent rows. Rows contain a local presentation ID, conversation label when
Main can resolve it, action, status, and timestamp; raw conversation/operation
IDs and prompt/response content are never rendered. Disable uses the existing
compact destructive confirmation when authenticated clients are connected.

## Security And Privacy

- Renderer contracts are strict Zod schemas and reject oversized, malformed,
  path-bearing, secret-bearing, or uncloneable values at each boundary.
- External Control stores only a current-user identity key, enable preference,
  descriptor, and bounded metadata audit; it does not use Electron
  `safeStorage`/Keychain for the bridge capability.
- Provider credentials for Pi's normal outbound model flow remain Main-owned
  and may use the existing credential repository; they are unrelated to the
  External Control token.
- Child processes receive a sanitized environment. No token, model credential,
  Session JSONL, raw prompt, tool argument/result, or absolute Session path is
  returned through MCP/IPC.
- Audit rotation is bounded at 1 MiB with cross-platform old-sibling cleanup;
  non-ENOENT rotation errors fail the append rather than allowing unbounded
  growth.

## Build And Package Boundary

The current lockfile resolves Electron `43.4.1`, electron-vite
`6.0.0-beta.1`, Vite `8.2.2`, `@vitejs/plugin-react@6.1.0`, Tiptap `3.30.2`,
Vitest `4.1.11`, and MCP SDK `@modelcontextprotocol/server@2.0.0`.
`electron-vite build`
produces Main, preload, Renderer, Pi Host utility, and management-helper
entries. `electron-builder.yml` packages compiled output and production
dependencies in ASAR, unpacks native bindings, and excludes source, tests,
docs, credentials, Pi data, and Trellis development directories.

The first release is `0.0.1`; macOS is ad-hoc/not notarized and Windows is
unsigned. Native release claims are platform-specific: the current worktree
has a real macOS arm64 packaged smoke; Windows/Linux package and smoke jobs are
CI/device evidence and are not claimed locally unless those jobs run.

## Verification

The current executable checks are listed in [the test matrix](TEST_MATRIX.md).
At minimum, shared contract changes require `pnpm typecheck` and focused Vitest;
Main/preload/Renderer changes require Electron E2E; startup/native/package
changes require `pnpm build`, a platform package, and packaged smoke. The
2026-08-22 checkpoint passed typecheck, focused MCP/bootstrap tests, production
build, local macOS arm64 unpacked packaging, and the packaged MCP smoke.
