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

## References

- `tests/unit/ipc-contracts.test.ts`
- `tests/unit/pi-host-runtime-manager.test.ts`
- `tests/unit/project-host-pool.test.ts`
- `tests/unit/local-pi-rpc-renderer.test.ts`
