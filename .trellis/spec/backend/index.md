# PiPilot Desktop Runtime Guidelines

This section documents the current Electron Main, preload, embedded official Pi
SDK Host, and shared-module organization. PiPilot runs the exact bundled Pi SDK
inside project-scoped Electron utility processes; it does not maintain a
parallel Renderer/Main Agent worker or a production CLI/JSONL fallback.

## Guides

| Guide | Scope | Status |
| --- | --- | --- |
| [Directory Structure](./directory-structure.md) | Main, preload, shared, tests | Ready |
| [Service Patterns](./service-patterns.md) | Services, repositories, lifecycle, events | Ready |
| [Embedded Pi Host](./embedded-pi-host.md) | Bundled SDK utility hosts, MessagePort protocol, Runtime pool, IPC cutover | Ready |
| [Official Pi Session Catalog](./official-pi-session-catalog.md) | Scope resolution, observed directories, bounded read-only session navigation | Ready |
| [Conversation Context](./conversation-context.md) | Active project/projectless state, startup fallback, terminal cwd ownership | Ready |
| [Type And Validation Patterns](./type-and-validation-patterns.md) | Shared schemas and messages | Ready |
| [Quality Guidelines](./quality-guidelines.md) | Focused desktop verification | Ready |

The same Main ownership rules apply to the inbound External Control MCP
surface: `src/main/external-control/` owns the descriptor, bridge, inventory,
operation registry, audit, and lifecycle. Stdio and Renderer consume validated
DTOs rather than becoming alternate domain owners.

## Before Development

1. Locate the current owner of the operation and its nearest tests.
2. Trace any shared payload through sender, schema/contract, receiver, and
   renderer adapter before changing it.
3. Check lifecycle cleanup for processes, subscriptions, terminals, and files.

## Quality Check

1. Typecheck all changed layers.
2. Exercise the smallest relevant unit or integration test.
3. Run Electron/package checks when startup, packaging, or native modules change.
