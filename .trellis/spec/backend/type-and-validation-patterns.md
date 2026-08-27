# Desktop Type And Validation Patterns

## Shared Contracts

`src/shared/` is the current owner of shapes used by more than one runtime.
Examples include:

- `pipilot-api.ts`: renderer-facing facade.
- `ipc/contracts.ts`: named channels plus request and response schemas.
- `local-pi.ts`: exact supported official Pi RPC commands, responses, and events.
- `conversation-scope.ts`: path-free project/projectless scope and catalog types.
- `workspace-content.ts`: bounded file search and read-only Git change contracts.
- `settings.ts` and `schemas/workspace.ts`: persisted/domain parsing.
- `external-control.ts`: descriptor, bridge, inventory, operation, settings,
  and MCP tool DTOs shared by Main, stdio, preload, and Renderer.

When extending one of these existing protocols, change its schema, inferred
type, sender, receiver, and tests together.

## Message Pattern

- RPC and IPC messages use a `type` or operation discriminator plus
  operation-specific payload.
- Parse `unknown` at the receiving edge with the owning Zod schema.
- Keep bounds/constants near the schema or projection that enforces them.
- Parse the External Control descriptor path, bridge hello/request/result, MCP
  tool input/output, and Settings snapshot at every receiving boundary. Reject
  NUL bytes, non-absolute descriptor paths, stale protocol/instance identity,
  oversized frames, and raw secrets before filesystem/socket/IPC work.
- Keep official Pi DTO validation centralized in `shared/local-pi.ts`; do not
  independently cast the same response in Main, preload, and renderer.
- Match the official SDK's JSON semantics at the DTO boundary. Tool results
  have required `content` but optional `details`; an `undefined` details value
  is omitted by the plain-object projection and must still validate. Do not
  make an SDK field non-optional merely because most tool implementations
  populate it.
- Treat event projection and process health as separate contracts. A malformed
  non-transport SDK event may produce only the fixed Runtime-scoped
  `runtime_diagnostic/RUNTIME_EVENT_PROJECTION_FAILED` DTO; it must not be
  routed through Host-fatal listeners. Host/Utility/MessagePort failures keep
  their existing sanitized fatal envelope.

## Type Imports

Use `import type` for type-only dependencies. Renderer files normally use the
`@/` alias; Main and preload files use relative imports because they have
separate build entries.

## Avoid

- Maintaining a handwritten interface that duplicates a Zod-inferred payload.
- Parsing the same raw event fields independently in several consumers.
- Sending a filesystem path or third-party class instance where a bounded plain
  shared domain object exists.
- Returning an External Control token, Session path, raw prompt, tool
  argument/result, or unbounded error through bridge/stdio/IPC.
- Expanding a union without reviewing its switch/reducer sites.
- Promoting a single event projection parse error to a process or Host failure;
  this discards otherwise valid later events and can clear the selected
  Session.

## Scenario: Copyable External Control MCP Launcher

### 1. Scope / Trigger

Use this contract whenever Main resolves, Shared validates, preload forwards,
Renderer displays, or a test launches the copyable External Control stdio
configuration. The public contract is platform-neutral; installation paths and
the descriptor remain Main-private.

### 2. Signatures

- `resolveExternalControlMcpConfiguration(options): ExternalControlMcpConfiguration | null`.
- `ExternalControlMcpConfiguration`: `{ command: 'pipilot-mcp', args: [] }`.
- `ExternalControlLauncherService.inspect()/install()/uninstall()` owns platform
  discovery, install, repair, strict ownership/receipt validation, and
  current-user PATH registration/removal. Uninstall never changes External
  Control lifecycle or client-owned configuration.
- `bootstrapMain(argv)` detects the private `--pipilot-mcp-stdio` flag or the
  Windows `pipilot-mcp.exe` basename, initializes Electron headlessly, derives
  the private descriptor when omitted, and exits through `app.exit(code)`.

### 3. Contracts

- Settings displays and copies one canonical `mcpServers.pipilot` JSON document
  whose server entry contains only `command: 'pipilot-mcp'` and `args: []`.
- Shared/preload/Renderer never receive an absolute executable, descriptor,
  bootstrap flag, token, `env`, inferred home variable, or test-only target.
- macOS/Linux install only into a secure stable current-user directory already
  present in PATH. Repair requires an exact wrapper or a matching private
  receipt; unrelated and symlink targets fail closed.
- Windows uses the packaged lowercase `pipilot-mcp.exe` console-subsystem copy
  and preserves the current-user PATH value/type when registering its directory.
- Launcher snapshots expose only bounded state, restart guidance, errors, and a
  managed flag. Removal is available only with proven ownership. POSIX removal
  rechecks no-follow file identities; Windows removes exactly one owned PATH
  entry with exact read-back and rollback while retaining the packaged EXE.
- Windows loads `resources/app.asar` through Electron's normal packaged entry.
  Do not expose an ASAR argument, `ELECTRON_RUN_AS_NODE`, or another launcher
  environment through Shared, preload, Renderer, or copied JSON.

### 4. Validation & Error Matrix

| Input | Required outcome |
| --- | --- |
| valid packaged launcher source | return canonical `{ command: 'pipilot-mcp', args: [] }` |
| unpackaged app without explicit test executable | return `null` and report unavailable |
| missing/non-executable platform launcher | return `null` |
| unsafe/non-PATH target or unmanaged same-name file | refuse install/removal without mutation |
| absolute command, any arg, `env`, token, or unknown field | reject at the strict Shared schema |

### 5. Good / Base / Bad Cases

- Good: every platform publishes `pipilot-mcp` with no args, and native packaged
  smoke completes JSON-RPC over stdio through the installed launcher.
- Base: the current installation has no secure stable user directory in PATH,
  so Settings truthfully reports launcher installation as unsupported.
- Bad: publish the ASAR Main path plus `ELECTRON_RUN_AS_NODE`, or shorten an
  absolute descriptor to `~/`; clients then receive a platform-specific,
  secret-bearing, or non-expandable contract.

### 6. Tests Required

- Unit: assert the strict portable schema plus POSIX install/repair/uninstall/
  receipt/race behavior and verbatim Windows PATH merge/removal/rollback.
- Electron: enable External Control, install and confirm-uninstall the launcher through the bounded
  IPC, parse the displayed JSON, assert the exact `mcpServers.pipilot` document,
  and verify no overflow or leaked path.
- Packaged on each target OS: install and spawn `pipilot-mcp` with no args.
  Windows CI or a Windows machine is the authority for CUI stdio, registry PATH,
  and named-pipe ACLs.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "command": "C:\\Program Files\\PiPilot\\pipilot-mcp.exe",
  "args": ["--pipilot-mcp-stdio", "--descriptor", "~/.pipilot/descriptor.json"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" }
}
```

#### Correct

```json
{
  "mcpServers": {
    "pipilot": {
      "command": "pipilot-mcp",
      "args": []
    }
  }
}
```

## References

- `tests/unit/ipc-contracts.test.ts`
- `tests/unit/pi-host-runtime-manager.test.ts`
- `tests/unit/project-host-pool.test.ts`
- `tests/unit/local-pi-rpc-renderer.test.ts`
- `tests/unit/runtime-event-projector.test.ts`

## Scenario: Official Pi Tool-Result And Event Projection

### 1. Scope / Trigger

Use this contract when an official `AgentSessionEvent` is converted into a
shared Local Pi event and then reduced by Main/Renderer. It exists because the
official SDK may return an own-property with `details: undefined`, while the
JSON-safe DTO projection omits that property.

### 2. Signatures

- `localPiToolResultSchema`: `{ content: LocalPiContent[], details?: unknown,
  usage?, addedToolNames?, terminate? }` (strict object).
- `projectRuntimeEvent(event: AgentSessionEvent): LocalPiRpcEvent`.
- Runtime diagnostic: `{ type: 'runtime_diagnostic', code:
  'RUNTIME_EVENT_PROJECTION_FAILED' }`.
- Renderer `applyLocalPiProjectorEvent()` marks a runtime diagnostic as
  `shouldRefreshSnapshot: true` and does not synthesize a crash.

### 3. Contracts

- `content` is required and bounded by the existing Local Pi content schemas.
- `details` is optional; `undefined` is omitted by JSON-style projection and
  must not fail validation.
- A projection failure for one non-transport event emits only the fixed
  diagnostic for that Runtime. No raw SDK error, path, prompt, tool argument,
  or result is included.
- Utility exit, MessagePort/transport failure, Host bootstrap failure, and
  explicit extension shutdown continue through the sanitized Host-fatal path.

### 4. Validation & Error Matrix

| Input | Required outcome |
| --- | --- |
| `content` plus defined `details` | accept and preserve both |
| `content` plus `details: undefined` | accept and omit `details` in DTO |
| missing `content` | reject the event and emit the fixed Runtime diagnostic |
| malformed non-transport event | diagnostic, snapshot refresh, later events continue |
| Utility/transport/explicit shutdown failure | existing Host-fatal envelope and recovery semantics |

### 5. Good / Base / Bad Cases

- Good: official `write` completes, the DTO contains content without
  `details`, the tool call settles, and a following prompt is accepted.
- Base: an unknown event projection is diagnosed, the selected Runtime stays
  alive, and the authoritative snapshot repairs any sequence uncertainty.
- Bad: make `details` non-optional or send the projection exception to
  `fatalErrorListeners`, which clears the selected Session and kills sibling
  work.

### 6. Tests Required

- Unit: project the exact official `write` end shape and assert omitted
  `details` plus completed renderer tool presentation.
- Unit: inject a malformed non-transport event, assert one fixed diagnostic,
  no fatal listener call, and a later `agent_start` event.
- Electron: execute the SDK `write` tool, assert file persistence, `ready`, the
  same `sessionId`/`sessionFile`, no empty selection, and a following prompt.
- Packaged: repeat the Electron path in the current bundled app and continue
  the existing LRU and explicit Host-fatal recovery assertions.

### 7. Wrong vs Correct

#### Wrong

```ts
try {
  emitRuntimeEvent(projectRuntimeEvent(event))
} catch (error) {
  for (const listener of fatalErrorListeners) listener(error)
}
```

#### Correct

```ts
try {
  emitRuntimeEvent(projectRuntimeEvent(event))
} catch {
  emitRuntimeEvent(runtimeDiagnostic('RUNTIME_EVENT_PROJECTION_FAILED'))
}
```
