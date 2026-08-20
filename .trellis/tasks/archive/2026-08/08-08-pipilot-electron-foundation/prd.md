# PiPilot Electron and Pi SDK Foundation (Historical Migration)

## Status

This task imports work completed before Trellis was installed. It is historical
evidence, not a new implementation request and not a source of current UI,
architecture, security, credential, or data-integrity constraints.

## Goal

Preserve the completed Phase 0-13 PiPilot desktop implementation as one
searchable Trellis task, with links to the original reports and exact executed
verification.

## Original Product Requirements

- Turn the renderer prototype into a working Electron desktop application.
- Integrate Pi SDK sessions, streaming messages, tools, approvals, resources,
  models, and providers.
- Connect workspaces, files, Git diff operations, and a real terminal.
- Persist application settings and desktop state.
- Support the existing localized renderer and its web/mock development mode.
- Add unit, integration, Electron, visual, packaged, and packaging workflows.
- Produce local macOS arm64 and x64 artifacts and document release readiness.

## Migration Requirements

- Keep Phase 0 through Phase 13 discoverable from one task.
- Link the completion audit, architecture record, implementation plan, test
  matrix, packaging notes, and phase reports.
- Preserve exact pass counts and distinguish executed checks from unexecuted
  signing, notarization, publishing, and native Windows/Linux runs.
- Do not claim that the pre-Trellis work belongs to a Git commit while the
  current worktree remains uncommitted.
- Do not carry retired project constraints into active Trellis specs.

## Acceptance Criteria

- [x] Phase 0-13 scope is listed in `implement.md`.
- [x] The historical architecture and migration shape are in `design.md`.
- [x] Exact final verification and release caveats are in
  `research/completion-evidence.md`.
- [x] Original source documents are linked from the task.
- [x] The task context manifests reference real Trellis specs and research.
- [x] The task is archived as completed without staging or committing files.
