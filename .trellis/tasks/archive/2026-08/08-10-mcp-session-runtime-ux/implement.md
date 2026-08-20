# Implementation Plan

## Task Map And Order

This parent coordinates four child tasks and is not the primary code-editing
target.

1. Start and complete `08-10-runtime-session-reliability`.
2. After its shared contracts stabilize, implement
   `08-10-composer-extension-ux` and
   `08-10-local-pi-integrations-manager` in parallel with disjoint ownership.
3. Start `08-10-plan-retry-adapters` only after both preceding children expose
   their final generic activity and management/settings contracts.
4. Return to this parent for cross-child integration, spec synchronization,
   Electron workflows, packaging evidence, and final review.

Every child worker must read the parent PRD/design and its own artifacts. A
child may not absorb a deferred plugin because it is already installed.

## 1. Runtime And Session Reliability Child

- Separate the recursive official host response schema from the clone-safe IPC
  response schema.
- Project `get_tree` iteratively in Main and update preload/provider/Agent
  inspector consumption to the flat DTO.
- Replace fixed-attempt catalog churn failure with a bounded dirty-generation
  coordinator and suppress only superseded renderer refresh errors.
- Gate Files, Changes, and Pi Session on full conversation readiness; clear
  controllers and center empty/loading/error states.
- Add focused unit/contract regressions and one real Electron deep-tree and
  first-activation workflow.

## 2. Composer And Generic Extension UX Child

- Extract one shared compact picker shell and one pure active-option controller.
- Merge Commands and Skills into the first `/` level; remove nested SkillPicker
  navigation/search state.
- Render Files and Skills for typed `@` through the shared shell.
- Remove the toolbar `@` control and all now-unreachable synthetic-trigger
  editor logic while preserving attachment, Tiptap identity, clipboard, IME,
  and scope reset behavior.
- Add neutral generic tool cards and a collapsible current activity strip.
- Move notifications into the middle-column positioning context.
- Verify keyboard-only `/` and `@` flows and desktop/narrow light/dark layout.

## 3. Local Pi Integrations Manager Child

- Add the exact executable-to-package-root locator and isolated management
  helper protocol; do not add Pi as an application dependency.
- Implement bounded snapshot/progress/mutation services using the external
  Pi package's public package APIs; resource filters remain read-only.
- Add strict shared IPC/preload contracts and a renderer Integrations store with
  scope, operation, restart, stale-response, and unavailable states.
- Build responsive Overview, Packages, MCP, and Resources list/detail views.
- Refactor MCP structured editing into server list/add/edit while retaining Raw
  JSON and the existing parser/fingerprint document.
- Wire controlled restart to refresh runtime and management observations.
- Explain the read-only resource-filter boundary instead of implementing
  Pi's private `pi config` mutation logic.
- Verify exact-installation binding, project scope, serialization, conflict
  behavior, progress, and unavailable compiled-install behavior.

## 4. Plan And Retry Adapters Child

- Consume the finalized package snapshot and generic activity host.
- Implement exact Plan Mode capability schemas and project versioned plan
  details/status/custom messages into lifecycle-safe renderer state.
- Expose only direct public `/plan` routes and existing extension UI dialogs;
  retain generic fallback for every unsupported shape.
- Implement authoritative Retry settings through the management helper, active
  process synchronization, partial failure, official event projection,
  display-only countdown, Stop, recovered/final states, and separate
  summarization retry.
- Gate optional `pi-retry` status enrichment to the exact supported
  package/version/value set.
- Prove no second retry scheduler and no private/prose parsing exists.

## 5. Parent Integration Pass

- Re-read shared files changed by multiple children and resolve contracts at
  their owning layer rather than adding casts in `App`.
- Confirm only Plan Mode and Retry have package-specific adapter registrations.
- Run cross-layer stale-generation/session replacement scenarios covering
  notifications, activity, candidates, inspector, integrations, and adapters.
- Update backend/frontend specs only after implementation behavior is verified.
- Scan for the removed nested `/skills` state, toolbar trigger, viewport-fixed
  notifications, recursive renderer tree, false catalog error path, bundled Pi
  SDK, private plugin imports, and Subagents controls.

## Validation

Children run the focused commands in their own plans first. The parent then
runs the broad current-worktree gate because the combined work changes Main,
preload, shared contracts, renderer state, settings, and Electron startup:

```bash
pnpm typecheck
pnpm test:unit
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts
git diff --check
```

Run focused packaged workflows after the ordinary Electron suite:

```bash
pnpm package:dir
pnpm exec playwright test --config=playwright.packaged.config.ts
```

Before any Electron packaging/release command, load the `electron-builder`
skill as explicitly requested by the user. Do not claim signing,
notarization, release publishing, Windows, or Linux evidence unless those exact
steps are run.

## Shared Risk Files

- `src/App.tsx`, both locale catalogs, `src/store/pi-rpc.tsx`, shared IPC
  contracts, preload, fake Pi, and Electron specs are shared integration files.
- Composer work owns `Composer.tsx`, editor/picker components, and generic
  extension renderer UI until handoff.
- Integrations work owns package-management Main/preload/shared/settings files
  and `McpSettings` replacement until handoff.
- Adapter work must consume those contracts and must not reopen their ownership
  without coordination.
- Preserve unrelated worktree changes and `.agents` symlink/deletion noise.

## Rollback Points

- Runtime projection/catalog changes are one rollback unit because the renderer
  DTO and refresh lifecycle must agree.
- Composer/picker/generic surface changes are a renderer-only rollback unit.
- Management helper/contracts/UI are additive; disabling them leaves local Pi
  chat and existing config files intact.
- Plan and Retry adapters can be removed independently, leaving generic official
  Pi behavior.
- Explicit package/settings operations are user data changes and are never
  silently reversed by a code rollback.

## Pre-Start Gate

- Parent and all four children have converged PRD/design/implementation
  artifacts with no open product decision.
- Parent and child `implement.jsonl`/`check.jsonl` contain real spec/research
  entries and pass `task.py validate`.
- The user reviews the final planning summary and explicitly approves
  implementation in a subsequent message before any `task.py start`.
