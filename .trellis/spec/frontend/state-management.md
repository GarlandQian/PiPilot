# State Management

## State Categories

| State | Current owner | Example |
| --- | --- | --- |
| Temporary interaction state | Component `useState` | view and panel state in `src/App.tsx` |
| Cross-feature renderer state | Context provider/store | `src/store/workspace.tsx` |
| Official Pi event projection | Pure projector module | `src/renderer/pi-rpc/projector.ts` |
| Official Pi process/API state | Context provider | `src/store/pi-rpc.tsx` |
| Pi integration management state | Context provider | `src/store/pi-integrations.tsx` |
| Settings/workspace/MCP IPC | Renderer adapter | `src/renderer/adapters/` |
| External Control settings | `ExternalControlProvider` + renderer adapter | `src/store/external-control.tsx` |

## Store Pattern

- Providers own adapter creation, initial loading, subscriptions, and cleanup.
- Public hooks expose either snapshots or grouped actions rather than the raw
  context object when separation is useful.
- Updates are immutable. Functional `setState` updates are preferred when the
  next value depends on the previous snapshot.
- Pure derivation stays outside React so it can be tested directly. Examples:
  `deriveSessionState()` and the official Pi projector helpers.

## Async And Event State

- Compare responses with the current workspace/session/epoch before applying
  them when an operation can race with navigation.
- Runtime generations are monotonic only within one Runtime ID. A selected
  Runtime may legitimately have a lower numeric generation than the Runtime
  previously shown; use the confirmed scope/session identity instead of a
  global generation ordering.
- Session-changing commands may publish their new generation before the IPC
  response resolves. Do not reject those responses solely because the runtime
  generation changed; apply returned renderer state only after the exact new
  `{ scopeKey, generation, sessionId }` hydration is ready.
- A Main Runtime replacement may retry once and temporarily restore the prior
  healthy Runtime snapshot. The renderer's selected-row operation identity is
  still authoritative: keep the requested row/content in loading until its
  exact activation tuple hydrates or the request returns a terminal error;
  never mistake the restored prior snapshot for success of the new selection.
- Treat official Pi hydration identity as the complete
  `{ scopeKey, generation, sessionId }` tuple. A generation and session ID may
  remain unchanged while the selected project scope changes; hydration caches,
  in-flight responses, and ready-state guards must still reset and re-fetch for
  the new scope.
- Keep official event ordering in one projector. `applyLocalPiProjectorEvent()`
  rejects stale generations and marks uncertain sequences for snapshot refresh.
- Keep conversation render identity separate from late official provenance. A
  user-led response group keeps the local user-message ID as its React identity;
  a later `anchorEntryId` augments navigation and activity routing but must not
  replace that identity. Streaming assistant turns include their anticipated
  message slot, and transition keys normalize away transport phase and mutable
  timestamps so Thinking collapse and answer typing can settle without remounts.
- Reconcile optimistic state with the later adapter snapshot instead of keeping
  parallel permanent copies. `createSettingsStore()` is the reference.
- Store error codes when the UI only needs a stable presentation key; do not
  make components parse arbitrary thrown values.
- Every catalog `loading` transition must be paired with a bounded Main result
  or a Renderer error transition. Plugin/session event storms may request a
  follow-up refresh, but they must not extend the currently visible loading
  promise indefinitely.
- Catalog requests are scoped independently from the active conversation.
  Switching from project A to project B must not cancel A's in-flight catalog
  request unless A receives a replacement request or an explicit terminal
  state. Its eventual result may update A's inactive sidebar cache, but must not
  overwrite B's active `sessions` projection.
- A persisted expanded-project preference is catalog load intent. When the
  Sessions panel restores an available expanded project without a scoped cache,
  it must start that project's catalog request even when another project is
  active. Only a real in-flight request may render `loading`; synthetic `idle`
  state must not display a permanent spinner.
- Keep Settings navigation state separate from runtime capability state. The
  Integrations provider's selected global/project scope controls only the
  management screen. `PiRpcProvider` independently loads global plus the active
  project integration snapshots for each ready runtime generation, and discards
  results whose scope or generation no longer matches.
- Compose runtime package facts by Pi package identity, not renderer row ID.
  Project npm identities replace matching global identities; do not let
  Promise completion order or a Settings tab selection determine capability
  precedence.
- External Control snapshots have a monotonic Main `revision`. Apply initial
  `get`, subscription events, and `setEnabled` responses only when their
  revision is not older than the current snapshot; an older invoke response
  must not overwrite a newer event. Dispose both subscription and registered
  IPC handlers through generation-safe disposers.
- Recent External Control rows are generation-scoped to one enabled bridge
  session. Clear them before publishing a new `enabling` generation and ignore
  callbacks from old sessions so disable/re-enable cannot flash/update stale
  metadata. Load/retry errors must not mutate the persisted enabled preference.

## When To Add Global State

Promote state from a component when several distant branches consume it, when
it owns an adapter subscription, or when it must survive switching between
views. Otherwise keep it local.

## Avoid

- Duplicating the same adapter subscription in multiple components.
- Applying stale async results after the active workspace or session changes.
- Keying authoritative hydration or async request caches by only generation and
  session ID; this can suppress the required refresh after a scope switch and
  leave the renderer indefinitely loading.
- Keying a response group by an `anchorEntryId` that can arrive after streaming
  starts; changing the group key on provenance hydration skips exit animations
  and discards component-local interaction state.
- Computing durable derived state separately in several components.
- Mutating arrays or maps that React consumers already hold.
- Reusing the management UI's selected-scope snapshot as the active Agent's
  capability snapshot.
- Applying a supported global adapter after an unsupported project package of
  the same npm identity has shadowed it.
- Applying an External Control invoke result without comparing its revision to
  the newest subscribed snapshot.
