# PiPilot Frontend Guidelines

These files describe the renderer as it exists today. They are a starting point
for consistent changes, not a UI freeze. A Trellis task may redesign the UI,
replace a pattern, or reorganize modules when its PRD and design call for it.

## Current Stack

- React 19 and TypeScript, built by Vite through electron-vite.
- Tailwind CSS utilities and tokens from `src/styles/globals.css`.
- Local shadcn/Radix wrappers in `src/components/ui/`.
- React Context stores and renderer adapters; no external state or query library.
- External Control state is a Main-owned subscribed snapshot exposed through a
  strict preload facade and rendered inside the existing Integrations tabs.

## Guides

| Guide | Scope | Status |
| --- | --- | --- |
| [Directory Structure](./directory-structure.md) | Renderer folders and module placement | Ready |
| [Component Guidelines](./component-guidelines.md) | Components, props, composition, styling | Ready |
| [Hook Guidelines](./hook-guidelines.md) | Hooks, subscriptions, and effects | Ready |
| [State Management](./state-management.md) | Local state, stores, adapters, event state | Ready |
| [Official Pi Renderer](./official-pi-renderer.md) | Generation-safe RPC projection, actions, Composer payloads | Ready |
| [Read-Only Changes](./read-only-changes.md) | Continuous, bounded, lazy Git Diff presentation | Ready |
| [Type Safety](./type-safety.md) | Type ownership and runtime parsing | Ready |
| [Quality Guidelines](./quality-guidelines.md) | Review and focused verification | Ready |

## Before Development

1. Identify whether the change belongs to a component, a store, an adapter, or
   a shared contract.
2. Read two nearby examples before introducing a new local pattern.
3. Trace Electron Main, preload, renderer provider, and presentation together
   when editing a cross-runtime flow. There is no standalone web/mock branch.
4. Put user-visible text in the existing locale catalogs when continuing the
   current localization system.
5. For External Control, keep raw conversation/operation IDs, prompt/response
   content, descriptor token, and canonical Session targets out of Renderer.

## Quality Check

1. Verify state ownership and subscription cleanup.
2. Check discriminated-union branches and stable list identities.
3. Run the smallest applicable command from `package.json`.
4. For intentional visual work, inspect the changed screen directly; the old
   frozen-layout documents have been retired.
