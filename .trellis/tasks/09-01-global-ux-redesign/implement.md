# Global UX Redesign Implementation Plan

## Execution Rules

- Follow `prd.md` and `design.md`; do not start by restyling isolated controls.
- Before editing, read `.trellis/spec/frontend/official-pi-renderer.md` directly
  and completely. It exceeds Trellis's automatic context-injection size, so it
  is intentionally not included in `implement.jsonl` or `check.jsonl`.
- Preserve existing Main/preload/Host ownership and official Pi projections.
- Keep the application usable at the end of every phase.
- Use existing tokens, UI primitives, Tabler icons, and locale infrastructure.
- Add an abstraction only when it owns a stable route, state projection, or
  repeated interaction recipe.
- Run focused checks after each phase and the full quality gate after Phase 7.
- Stop at a review gate if the real Electron result requires a system-level
  visual direction different from the approved design.

## Phase 0: Baseline And Contracts

- [x] Capture the current route, selected Session, draft, transcript scroll,
      Inspector tab/detail, and panel preference behavior in focused tests.
- [ ] Record fresh pre-change Electron screenshots at 1440x900 and 1100x680 in
      light and dark themes using stable fixtures.
- [x] Add pure Renderer types/helpers for the discriminated app route, route
      normalization, frame layout mode, and settings route metadata.
- [x] Define one session presentation state and one status projection
      from existing catalog and Runtime sources.
- [x] Audit whether any required status is missing before changing a
      cross-process contract; durable unread/acknowledged state has no
      authoritative catalog field or read cursor and remains deferred.

Validation:

```bash
pnpm exec vitest run tests/unit/layout-preferences.test.ts tests/unit/session-state.test.ts
pnpm typecheck
```

Review gate: route and projection helpers have no React or IPC side effects,
and pre-change evidence reproduces the minimum-width failure.

## Phase 1: Frame, Routing, And Responsive Composition

- [x] Replace independent Sessions/Integrations/Settings navigation state with
      the Conversation/Settings route model.
- [x] Remove Integrations from the top-level rail and route its command-palette
      entries into the unified settings workspace.
- [x] Update keyboard shortcuts and accessible labels for the new destinations.
- [x] Keep the conversation mounted but hidden/inert in Settings; restore the
      exact conversation workspace state on return.
- [x] Render wide conversation, compact conversation, wide settings, and
      compact settings compositions from available frame width.
- [x] Hide Inspector and its resize handle in Settings.
- [x] Add compact Inspector detail-layer focus trapping, Escape close, and
      focus restoration using the existing Dialog/overlay primitives where
      appropriate.
- [x] Normalize obsolete route preferences and clamp retained panel widths.
- [x] Remove the duplicate top-level Integrations render path only after deep
      settings routes work.

Likely owners:

- `src/App.tsx`
- `src/components/frame/ActivityRail.tsx`
- `src/components/frame/CommandPalette.tsx`
- `src/components/frame/ContextPanel.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/renderer/layout-preferences.ts`

Focused verification:

```bash
pnpm exec vitest run tests/unit/layout-preferences.test.ts tests/unit/settings.test.ts
pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/integrations.electron.spec.ts
```

Review gate: 1100x680 has no page-level horizontal scroll or character-by-
character wrapping; Settings round-trip preserves the live conversation.

## Phase 2: Sessions And Status Navigation

- [x] Recompose the contextual panel around the existing project/Session
      inventory and shared row component.
- [x] Keep Runtime status on the owning Session rows without creating a second
      Activity destination or Session store.
- [x] Standardize row identity, selected, opening, running, waiting, completed,
      failed, and released-runtime presentation.
- [ ] Add durable unread/acknowledged presentation after Main exposes an
      authoritative unread field or persisted read cursor.
- [x] Keep persisted Sessions visible after Runtime release.
- [x] Make only the selected hydration row spin; eliminate project-level
      indefinite loading placeholders after catalog resolution.
- [x] Enforce latest-selection-wins across conversation and Inspector and keep
      centered loading visible through full hydration.
- [x] Preserve expansion, search/filter, rename, duplicate, delete, remove
      project, and new project Session workflows.
- [x] Add accessible status names and reduced-motion behavior.

Likely owners:

- `src/components/frame/SessionsPanel.tsx`
- `src/components/layout/SessionList.tsx`
- workspace/session projection helpers and stores already used by `App.tsx`

Focused verification:

```bash
pnpm exec vitest run tests/unit/session-state.test.ts tests/unit/workspace-adapter.test.ts tests/unit/official-pi-session-catalog.test.ts
pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/pipilot.electron.spec.ts
```

Review gate: rapid switching, concurrent running Sessions, failed hydration,
Runtime release, rename, and delete all retain correct row and central state.

## Phase 3: Conversation And Execution Timeline

- [x] Establish semantic turn containers for user prompt, assistant response,
      execution timeline, and response actions.
- [x] Keep user messages visually distinct and assistant prose unframed.
- [x] Apply typewriter presentation only to new live assistant text; render
      hydrated history immediately and preserve Markdown block stability.
- [x] Auto-expand active reasoning and auto-collapse it after completion while
      respecting manual user expansion and reduced motion.
- [x] Recompose tool rows around concise summaries and progressive details.
- [x] Remove duplicate raw argument presentation from Bash; present output as
      terminal/code content, not Markdown.
- [x] Keep generic JSON in `StructuredValueView` and route documented Markdown
      results through the shared Markdown renderer.
- [x] Present subagent execution as an ordered in-turn summary and preserve the
      Inspector detail handoff.
- [x] Attach retry, queue/steer acknowledgement, extension, warning, and error
      notices to their owning response turn.
- [x] Preserve user image attachments in both live and hydrated messages.
- [x] Replace silent truncation with an explicit bounded-detail affordance.

Likely owners:

- `src/components/chat/MessageList.tsx`
- `src/components/chat/ToolActivityRegion.tsx`
- `src/components/chat/ToolCallCard.tsx`
- `src/components/chat/StructuredValueView.tsx`
- `src/components/chat/ShellEvidence.tsx`
- `src/components/chat/UserMessageContent.tsx`
- `src/renderer/pi-rpc/presentation.ts`
- `src/renderer/pi-rpc/live-typewriter.ts`
- existing tool/subagent presentation helpers

Focused verification:

```bash
pnpm exec vitest run tests/unit/live-typewriter.test.ts tests/unit/local-pi-rpc-presentation.test.ts tests/unit/tool-activity-presentation.test.ts tests/unit/tool-presenters.test.ts tests/unit/subagent-tool-call-card.test.ts tests/unit/user-message-content.test.ts tests/unit/structured-value.test.ts
pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/pipilot.electron.spec.ts
```

Review gate: a long mixed turn can be scanned without expanding raw JSON, and
its live-to-complete transition does not jump, replay text, or lose content.

## Phase 4: Composer, Pickers, Queue, And Steer

- [x] Recompose Composer visual hierarchy around one stable editor shell.
- [x] Use one full-width adjacent picker recipe for `/` Commands/Skills and `@`
      Files/Skills.
- [x] Complete keyboard behavior, focus return, empty/loading/error, and active
      descendant semantics for both pickers.
- [x] Keep right-click file reference insertion semantically identical to `@`.
- [x] Clarify idle Send, running Stop, Queue, and Steer actions without changing
      the authoritative Pi operation model.
- [x] Allow queued content to be promoted to Steer with text, mentions, and
      images intact.
- [x] Preserve drafts and attachments across switching, Settings, queue/steer,
      and recoverable errors.
- [x] Prevent empty text content parts while allowing supported attachment-only
      submissions.
- [x] Keep Enter/Ctrl+Enter preference behavior and accessible command labels.

Likely owners:

- `src/components/chat/Composer.tsx`
- `src/components/chat/ComposerEditor.tsx`
- `src/components/chat/ComposerPicker.tsx`
- `src/components/chat/ComposerMentionPicker.tsx`
- `src/components/chat/SkillPicker.tsx`
- `src/renderer/composer/`
- `src/renderer/pi-rpc/queue-payloads.ts`

Focused verification:

```bash
pnpm exec vitest run tests/unit/composer-controls.test.ts tests/unit/composer-picker.test.ts tests/unit/composer-mentions.test.ts tests/unit/composer-skills.test.ts tests/unit/composer-submission.test.ts tests/unit/queue-payloads.test.ts
pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/composer-extension.electron.spec.ts
```

Review gate: every Composer state is keyboard operable and switching context
cannot silently discard pending content.

## Phase 5: Inspector And Contextual Detail

- [x] Preserve Files, Changes, Outline, and Terminal as domain tabs in wide
      mode and as the same content inside compact detail mode.
- [x] Implement contextual detail push/back for subagents, restoring prior tab,
      scroll, and focus.
- [x] Align no-selection, selection-loading, ready, and error states with the
      conversation selection generation.
- [x] Keep file tree search, source/preview, binary/large/unavailable handling,
      material icons, and context-menu Composer insertion.
- [x] Keep Changes as one continuously scrollable surface while loading large
      files independently.
- [x] Keep Outline jump identity stable across transcript updates.
- [x] Avoid recreating the live Terminal simply because the Inspector changes
      presentation mode.

Likely owners:

- `src/components/inspector/InspectorPanel.tsx`
- `src/components/inspector/SubagentExecutionPanel.tsx`
- `src/components/inspector/FileTree.tsx`
- `src/components/inspector/WorkspaceFileViewer.tsx`
- `src/components/inspector/DiffViewer.tsx`
- `src/components/inspector/ConversationOutlinePanel.tsx`
- `src/components/inspector/RealTerminalPanel.tsx`

Focused verification:

```bash
pnpm exec vitest run tests/unit/continuous-diff-controller.test.ts tests/unit/conversation-outline.test.ts tests/unit/workspace-file-viewer.test.ts tests/unit/workspace-file-kind.test.ts tests/unit/terminal-service.test.ts
pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/pipilot.electron.spec.ts
```

Review gate: all Inspector destinations remain useful at 1440x900 and 1100x680
without stale data, layout squeeze, or process churn.

## Phase 6: Settings And Management Workflows

- [x] Reorganize Settings navigation into Preferences, Models and Runtime,
      Packages and MCP, and About.
- [x] Implement wide list/detail and compact drill-in presentation with stable
      route, selection, scroll, Back, and focus behavior.
- [x] Remove duplicated model inventory and give provider/model rows consistent
      actions and status placement.
- [x] Ensure API type uses the supported Select schema and provider/model tests
      report actionable pending/success/error results inline.
- [x] Recompose Integrations Overview as a compact problem/action summary and
      remove the large compatibility matrix.
- [x] Standardize package/resource states and Runtime Reload -> Host restart
      feedback without changing adapter ownership.
- [x] Align MCP structured editing, Raw JSONC, scope/path presentation,
      validation, and destructive confirmation with the shared settings recipe.
- [x] Align External Control with the same recipe without operating-system-
      specific UI branches.
- [x] Preserve advanced unknown fields and existing configuration files.

Likely owners:

- `src/components/settings/SettingsLayout.tsx`
- `src/components/settings/common.tsx`
- `src/components/settings/ModelsSettings.tsx`
- `src/components/settings/ModelsProviderFormDialog.tsx`
- `src/components/settings/ModelsModelFormDialog.tsx`
- `src/components/settings/IntegrationsSettings.tsx`
- `src/components/settings/McpSettings.tsx`
- `src/components/settings/McpServerFormDialog.tsx`
- existing Renderer settings/config adapters

Focused verification:

```bash
pnpm exec vitest run tests/unit/settings.test.ts tests/unit/models-config-schema.test.ts tests/unit/models-config-service.test.ts tests/unit/mcp-config-parser.test.ts tests/unit/mcp-config-service.test.ts tests/unit/mcp-server-form-model.test.ts tests/unit/mcp-path-presentation.test.ts tests/unit/pi-integrations-service.test.ts tests/unit/external-control-settings-contracts.test.ts
pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/integrations.electron.spec.ts tests/electron/external-control-settings.electron.spec.ts
```

Review gate: common management operations are structured and understandable;
advanced raw editing remains available without dominating the workflow.

## Phase 7: Product-Wide Integration And Visual Review

- [x] Audit loading, empty, ready, error, unavailable, progress, success,
      destructive, selected, hover, focus, and disabled states across changed
      surfaces.
- [x] Add all changed copy to English and Chinese locales and run the locale
      completeness test.
- [x] Verify light/dark, reduced motion, normal/high density where supported,
      keyboard-only use, accessible names/descriptions, and focus restoration.
- [x] Verify no page-level horizontal scroll, overlap, stale data flash, or
      unstable control dimensions at 1440x900 and 1100x680.
- [x] Build and launch the real Electron app with stable fixtures; capture
      current-worktree candidate screenshots for every design scenario.
- [x] Compare candidates against approved PiPilot references and request user
      confirmation before promoting any screenshot into the UI-style Skill.
- [x] Run the complete unit, Electron, integration, and relevant packaged gates.
- [x] Review the final diff for unrelated refactors, new dependencies, hard-
      coded user paths, temporary screenshots, and generated artifacts.

Full verification:

```bash
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:electron
pnpm test:integration
pnpm test:packaged
```

Packaged tests may be limited to the platforms available in the current
environment. Report exact platforms and commands; do not claim unrun evidence.

Final review gate: all PRD acceptance criteria have direct test or visual
evidence, and the real Electron UI still reads as one PiPilot design system.

## Completion Evidence And Known Limits

- Fresh current-worktree candidate screenshots were reviewed at 1440x900 and
  1100x680 in light and dark themes. They remain under
  `/private/tmp/pipilot-global-ux-visual-2026-09-02/` and were not promoted into
  the UI-style Skill because no new baseline confirmation was requested.
- Pre-change screenshots were not captured before implementation; the written
  audit in `research/current-ux-audit.md` remains the baseline evidence.
- `pnpm typecheck`, `pnpm build`, all 704 unit tests, all 19 Electron tests, both
  integration tests, and both packaged macOS tests passed. Windows/Linux
  packaged behavior was not exercised in this macOS worktree.
- Durable unread/acknowledged state remains intentionally unimplemented. The
  current official catalog/runtime projections expose no authoritative unread
  field or read cursor; a Renderer-only approximation would fabricate state.
- One Integrations restart IPC object error appeared once during review but did
  not reproduce in the fresh-build 19/19 Electron run. It remains a candidate
  for future investigation rather than an unsupported speculative change.
- Models configuration was covered by unit and visual evidence; an Electron
  mutation test was not added because the current service resolves the real
  home configuration and the fixture cannot safely isolate `models.json`.

## Rollback Points

- After Phase 1: restore prior route/frame composition without touching Session
  or Pi data.
- After Phase 2: revert only Session status projection if catalog behavior is
  incorrect; retain the frame.
- After Phases 3-5: revert individual presentation components without changing
  Runtime protocol or stored Sessions.
- After Phase 6: restore prior structured settings components without changing
  the underlying configuration files.
- Never roll back by deleting user configuration, Session data, or tests.
