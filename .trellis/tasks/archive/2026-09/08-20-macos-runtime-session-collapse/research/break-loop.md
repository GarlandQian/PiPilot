## Bug Analysis: Official `write` Result Collapsed the Project Host

### 1. Root Cause Category

- **Category**: B + D — Cross-layer contract and test coverage gap.
- **Specific cause**: Pi `0.84.2` returns a successful `write` tool result with
  `details: undefined`. The JSON-safe Main DTO projection omits undefined
  fields, but `localPiToolResultSchema` required `details`. The event
  projection exception was incorrectly routed to Host-fatal listeners, so the
  Utility closed the project Host and Renderer cleared the selected Session.

### 2. Why Earlier Verification Missed It

1. The earlier Electron and packaged fixtures exercised an explicit extension
   shutdown, which proved recovery but did not execute the official `write`
   result shape.
2. Unit coverage populated `details`, so it never crossed the undefined-to-
   omitted JSON boundary.
3. Production logs retained only the bounded Host-fatal code; correlating that
   timestamp with the persisted Session tail was required to identify `write`.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific action | Status |
| --- | --- | --- | --- |
| P0 | Shared contract | Keep tool `details` optional and validate official JSON semantics in `shared/local-pi.ts` | DONE |
| P0 | Runtime boundary | Scope non-transport projection defects to a fixed Runtime diagnostic; reserve fatal listeners for Host/transport failures | DONE |
| P0 | Regression | Run the exact `write` path through unit, Electron, and packaged workflows | DONE |
| P1 | Documentation | Keep the seven-section contract in backend validation and embedded Host specs | DONE |
| P1 | Correlation | Compare bounded lifecycle diagnostics with the persisted Session tail before assigning blame to plugins/providers | DONE |

### 4. Systematic Expansion

- **Similar issues**: Any SDK result with optional or undefined fields can fail
  if the DTO schema models common implementation output instead of the official
  JSON contract.
- **Design improvement**: Keep event projection, Runtime health, and Host
  transport failure as separate state machines.
- **Process improvement**: Every SDK event-shape change needs one shared
  projector test plus one real SDK Electron test; packaged behavior is required
  when the report comes from an installed build.

### 5. Knowledge Capture

- [x] Updated `.trellis/spec/backend/embedded-pi-host.md`.
- [x] Updated `.trellis/spec/backend/type-and-validation-patterns.md`.
- [x] Updated `.trellis/spec/frontend/official-pi-renderer.md`.
- [x] Updated `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [x] Updated the active task PRD, design, and implementation checklist.
