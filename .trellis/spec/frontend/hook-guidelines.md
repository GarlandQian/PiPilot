# Hook Guidelines

## Where Hooks Live

PiPilot does not have a generic hooks directory. Hooks stay with the owner of
their state or side effect:

- Store hooks: `src/store/settings.tsx`, `pi-rpc.tsx`, `workspace.tsx`.
- Localization hooks: `src/i18n/index.ts`.
- Document/theme effects: `src/lib/theme.tsx`.
- Component-specific state and effects: inside the component file.

Create a separate hook module only when multiple owners reuse the same stateful
behavior and no existing store or library module owns it.

## Store Hooks

- A context consumer throws a clear error when its provider is missing. See
  `useStore()` in `src/store/settings.tsx`.
- External store factories expose `get`, `subscribe`, and `dispose`, then use
  `React.useSyncExternalStore` in the public hook.
- Action hooks memoize stable command objects with `useMemo` when consumers pass
  them down as props.

## Effects And Subscriptions

- Subscribe and unsubscribe in the same effect.
- Use an effect-local `disposed` flag when an async initialization can finish
  after unmount. `WorkspaceProvider` is the reference.
- Use refs for the latest mutable snapshot when async callbacks must compare
  their result with current state (`stateRef`, `workspaceEpoch`).
- Include all captured values in dependency arrays; stabilize shared callbacks
  with `useCallback` when needed.

## Data Access

There is no React Query/SWR or standalone web/mock layer. Desktop data arrives
through the validated `window.pipilot` preload facade. Settings, workspace, and
MCP use adapters; the official Pi provider consumes its typed facade directly
because it owns generation-tagged commands and events as one lifecycle.

## Avoid

- Starting subscriptions during render.
- Omitting cleanup because an adapter currently returns a no-op function.
- Closing over a state snapshot in long-running async work when a ref or epoch
  check is needed.
- Creating a pass-through hook that adds no ownership or reusable behavior.
