# Desktop Service Patterns

## Composition

`src/main/index.ts` creates long-lived repositories and services, passes them to
IPC registration functions, and disposes them during application shutdown.
Follow this composition style when extending the current architecture:

- Constructor/options objects receive paths, clocks, ID factories, callbacks,
  or collaborating services.
- Registration functions receive an explicit options object rather than import
  application singletons.
- Services expose focused domain methods and a lifecycle method when they hold
  resources.

References:

- `src/main/pi-host/pi-runtime-frontend.ts`
- `src/main/pi-host/project-host-pool.ts`
- `src/main/conversations/conversation-context-service.ts`
- `src/main/terminal/terminal-service.ts`
- `src/main/repositories/workspace-repository.ts`
- `src/main/ipc/register-local-pi-ipc.ts`

## Errors

Current domain services define named error classes with a stable `code` and a
message. IPC modules map known errors to `MainProcessError`; unexpected values
are either rethrown or mapped to the operation's fallback code. Keep error
mapping next to the adapter that crosses into IPC.

## Events And Cleanup

- Subscription methods return a detach function.
- Listener invocation is isolated when one listener should not interrupt the
  owning service.
- Pi process/session events carry generation and sequence information;
  consumers compare these before applying state.
- Services that own timers, workers, PTYs, or subscriptions expose cleanup and
  are disposed from the app lifecycle.

## Pi JSONC Config Services (MCP, models.json)

Services that edit Pi-owned JSONC files (`mcp.json`, `models.json`) share one
pattern: read raw bytes, sha256-fingerprint them, parse through a shared
comment-preserving `jsonc-parser` module, write atomically (sibling tmp +
rename), and refuse saves whose expected fingerprint no longer matches the
file on disk (conflict result, never silent overwrite). Secrets are redacted
before anything crosses IPC — the renderer-facing DTO carries a presence
flag only (e.g. `hasApiKey`), so a leak fails typecheck. Runtime-visible
changes go through the controlled Pi restart and report the honest apply
outcome (`saved` / `restarted` / `pending` / `unavailable` / `failed`).

## External Control Services

External Control is composed in Main from explicit repositories and services:
descriptor/identity/preference repositories, bridge server/client, bounded
inventory, operation registry/control service, audit repository, and lifecycle
service. A service must not import Renderer state or expose SDK objects.
`start()`/`close()` and `dispose()` are distinct ownership steps; shutdown
closes bridge clients and endpoint state before releasing Runtime control.

Bridge acquisition is transactional from socket listen through descriptor
publish. Any chmod, schema, or publish failure rolls back server, clients,
socket, and descriptor state. Cleanup attempts every resource and reports the
first failure only after all resources have been attempted. Unauthenticated
connections count toward transport capacity, while Settings client count
includes only authenticated clients. Handshake timers are unref'd and cleared
on authentication/close.

Operation services subscribe to exact Runtime events before external submit,
bind the acquired lease before dispatch, and release it in `finally`.
Pre-acceptance buffering contains only bounded attribution events, never raw
tool payloads. Waiters handle already-aborted signals and are removed on client
disconnect. Runtime ID, generation, Session identity, acceptance order, and
authoritative queue/user/settled boundaries must match; ambiguity fails closed.

## Repositories

Repository classes own exact current-version file formats and expose domain
snapshots, revisions, and update methods. This unreleased product does not add
legacy migrations unless a future task explicitly requires one. Invalid or old
documents recover through the repository's documented current-schema path.

## Avoid

- Importing a Main singleton into a shared schema or renderer module.
- Letting IPC registration accumulate core domain logic that belongs in a
  service.
- Adding a long-lived handle without a defined shutdown path.
- Duplicating error-code translation in several handlers.
