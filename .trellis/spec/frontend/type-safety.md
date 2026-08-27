# Frontend Type Safety

## Type Ownership

- Cross-runtime API and domain types live in `src/shared/`, including
  `PiPilotApi`, official Pi RPC types, settings, terminal, conversation scopes,
  workspace content, and IPC contracts.
- Renderer-only presentation types live in `src/types/`.
- Feature-local props and helper types stay near their component or store.
- Prefer deriving callback or model types from the owning component/API when it
  avoids duplicate signatures. `ElectronComposer` uses
  `Parameters<typeof Composer>[0]` for this purpose.

## Runtime Parsing

The current desktop flow uses Zod schemas in `src/shared/schemas/` and contract
parsers in `src/shared/ipc/contracts.ts`. When adding to those existing
protocols, update the runtime schema and exported TypeScript type together.
Use `safeParse` when invalid input is an expected branch and `parse` when the
caller should fail immediately.

## Discriminated Data

- Official Pi messages, responses, events, extension requests, and runtime
  statuses are discriminated unions. Narrow on `state`, `type`, or `method`
  before reading variant fields.
- Use exhaustive `switch` blocks for reducer transitions where practical.
- Preserve `readonly` inputs for lists received as immutable data.
- Prefer `unknown` plus a schema/type guard at an untyped entry over `any`.

## Avoid

- Re-declaring a shared API payload in a component.
- Broad `as` assertions to bypass a protocol mismatch.
- Non-null assertions unless control flow already proves the value and the local
  API cannot express that fact.
- Adding optional fields to silence errors without confirming whether absence
  is a real state.

## References

- `src/shared/local-pi.ts`
- `src/shared/ipc/contracts.ts`
- `src/renderer/pi-rpc/projector.ts`
- `tests/unit/local-pi-rpc-renderer.test.ts`
