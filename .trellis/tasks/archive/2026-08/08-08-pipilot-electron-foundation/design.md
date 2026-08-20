# Historical Design Record

## Purpose

This document summarizes the implementation shape at the end of the pre-Trellis
work. It describes what exists; it does not freeze the architecture for future
tasks.

## Completed Shape

```text
React renderer
  -> preload `window.pipilot` facade
  -> Electron Main services and repositories
  -> Agent Utility Process running Pi SDK

Shared TypeScript and Zod modules describe desktop operations and events.
Renderer adapters connect desktop APIs to React Context stores and reducers.
```

Major source areas at completion:

- `src/components/`, `src/store/`, and `src/renderer/adapters/`: renderer UI,
  application state, and desktop adapters.
- `src/preload/`: desktop facade construction.
- `src/main/`: application lifecycle, IPC registration, repositories,
  workspace/file operations, PTY service, window management, and worker
  supervision.
- `src/agent-worker/`: Pi SDK runtime, session projection, permissions,
  resources, models, and transcript handling.
- `src/shared/`: cross-runtime APIs, schemas, protocols, and domain types.
- `tests/`: unit, integration, Electron, visual, and packaged checks.

## Historical Data Flow

1. Renderer actions call an adapter backed by `window.pipilot` in desktop mode.
2. Preload maps the facade operation to a named desktop request.
3. Main routes the request to a repository/service or to the Agent Worker.
4. Worker events are projected into shared domain events.
5. Renderer stores/reducers reconcile snapshots and streaming updates.

Web mode keeps deterministic mock/local adapters for browser development and
visual scenarios.

## Migration Shape

The original numbered reports remain under `docs/`. Trellis stores a compact
index and evidence record instead of copying every report. Current coding
guidance lives only under `.trellis/spec/`; historical design statements here
do not override a future task PRD or design.

## Source Documents

- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/COMPLETION_AUDIT.md`
- `docs/TEST_MATRIX.md`
- `docs/PACKAGING.md`
- `docs/PHASE_0_REPORT.md` through `docs/PHASE_13_REPORT.md`
