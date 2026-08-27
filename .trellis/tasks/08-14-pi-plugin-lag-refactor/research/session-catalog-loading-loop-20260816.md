# Bug Analysis: Session catalog remains loading under event churn

## 1. Root Cause Category

- **Category**: B/D/E — cross-layer contract, test gap, and implicit assumption.
- **Specific cause**: `OfficialPiSessionCatalog.refreshFirstPage()` described a
  bounded foreground tranche but implemented an unbounded loop. Every
  `entry_appended`, `session_info_changed`, activation observation, or other
  catalog invalidation marked the coordinator dirty. After four scans or 250
  ms the code only yielded and reset its counters, then continued awaiting the
  same promise. A project with active plugins could therefore keep Main's IPC
  refresh unresolved forever, while Renderer correctly remained in `loading`.
- **Second cause**: `WorkspaceProvider.applyConversationNavigation()`
  incremented the previous project's catalog request ID during a scope switch.
  The old scoped result was then discarded, but no replacement request was
  started because that project had become inactive. Its sidebar cache therefore
  remained `loading` even though the newly active project was ready.
- **Third cause**: `SessionsPanel` restored expanded-project preferences after
  restart, but only a pointer-triggered expansion called `loadSessionCatalog()`.
  An already-expanded inactive project with no renderer cache was represented
  as `idle`, while `ProjectChildren` rendered `idle` with the same spinner and
  copy as a real request. The row could therefore spin forever without any IPC
  request existing to settle it.

## 2. Why earlier fixes did not close the bug

1. Refresh coalescing prevented duplicate scans but made all Renderer callers
   share the same never-settling promise.
2. Request IDs correctly rejected stale Renderer results, but no result existed
   to apply while Main kept retrying.
3. Existing burst coverage always stopped invalidating and asserted eventual
   convergence. It did not assert that the foreground promise resolves while
   invalidations are still arriving.
4. Scope-switch guards were treated as global cancellation even though catalog
   state is already keyed by scope and inactive results cannot overwrite the
   active conversation projection.
5. Expansion persistence was treated as presentation-only state. Restoring the
   visual state did not restore the data-loading side effect that manual
   expansion previously owned.

## 3. Prevention mechanisms

| Priority | Mechanism | Specific action | Status |
| --- | --- | --- | --- |
| P0 | Architecture | Separate bounded foreground publication from yielded background convergence. | Done |
| P0 | Test | Hold every foreground scan dirty and assert the shared refresh still resolves at the scan budget. | Done |
| P1 | Contract | Require every catalog loading state to have a bounded terminal result. | Done |
| P1 | Pagination safety | Retag the coherent foreground cache to the current catalog version before returning its cursor. | Done |
| P0 | Scope isolation | Let the previous scope's in-flight catalog request finish into its own inactive cache. | Done |
| P0 | State ownership | Treat restored expansion as load intent and dispatch one scoped catalog request. | Done |
| P1 | Honest UI | Render a spinner only for the real `loading` branch; `idle` has no loading presentation. | Done |

## 4. Systematic expansion

- Similar risks exist in any UI operation whose promise retries on every event:
  hydration, package refresh, Files, and Changes should keep background
  convergence separate from the user-visible loading promise.
- Event coalescing alone is not a liveness guarantee. A coordinator also needs
  a maximum foreground completion boundary.
- Incrementing an async request epoch is itself a state transition. If no
  replacement operation will settle that epoch, the current UI state must be
  restored or the request must be allowed to finish.
- Persisted interaction state can imply required data work. Restoring the open
  shape of a data-backed panel without restoring its load intent creates an
  impossible-looking state: visually loading, operationally idle.
- A stale-but-coherent catalog summary is acceptable for navigation because
  open and delete repeat canonical file/header validation before mutation.

## 5. Knowledge capture

- Updated backend catalog and frontend state-management contracts.
- Added a deterministic regression for continuous invalidation through the
  foreground scan limit followed by background convergence.
- Added a pure regression that only restored, available, expanded projects
  without a scoped catalog are selected for automatic loading.
- No template copy exists for these project-specific specs. The changes remain
  uncommitted for user review.
