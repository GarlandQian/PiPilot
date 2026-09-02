# Global UX redesign

## Goal

Redesign PiPilot's complete desktop user experience as one coherent system so
that daily work is easier to scan, faster to operate, and more predictable
across session navigation, live agent execution, configuration, and inspection.

The redesign must preserve PiPilot's confirmed restrained desktop-tool visual
language while improving information architecture, interaction hierarchy,
state visibility, keyboard operation, and cross-surface consistency.

## Background

- The user explicitly chose a global redesign rather than a narrowly scoped
  polish pass.
- PiPilot is a long-running local Electron client for official Pi sessions. Its
  primary frame contains project/session navigation, a central conversation,
  a parallel inspector, settings and integrations surfaces, and a compact
  status region.
- Earlier feedback repeatedly identified friction in session switching and
  status visibility, loading/empty transitions, streamed reasoning and tool
  presentation, Composer queue/steer and `/`/`@` pickers, model management,
  integrations/package compatibility, file preview, notifications, and status
  presentation.
- Existing UI tokens, primitives, localization, Electron boundaries, and the
  approved `pipilot-ui-style` language are constraints and evidence, not a
  prohibition on changing layout or interaction patterns.
- Current release-worktree captures confirm that the minimum-width frame can
  force Integrations detail content into character-by-character wrapping when
  Settings navigation, master/detail content, and the Inspector remain visible
  together. See `research/current-ux-audit.md`.

## Requirements

- Use a conversation-first organizing principle: Sessions and live agent work
  are the home surface; project identity is contextual; inspection and
  configuration open as task-specific workspaces without discarding the
  mounted conversation state.
- Remove Integrations as a duplicate top-level destination. Use a single
  settings-and-management workspace grouped into Preferences, Models and
  Runtime, Packages and MCP, and About. Keep direct command-palette routes to
  deep configuration destinations.
- The primary rail contains only conversation navigation and
  settings/management. Running, waiting, completed, and failed status remains
  visible on the owning Session row rather than adding a separate Activity
  destination.
- Opening settings/management hides the conversation Inspector and allocates
  the work width to configuration. Returning to conversation restores the
  previous transcript, draft, stream, scroll, session context, panel widths,
  and Inspector state.
- Establish one global information architecture for Sessions, Settings, and
  the Inspector, with clear ownership for primary navigation,
  contextual navigation, work content, and secondary detail.
- Redesign the application frame and responsive panel behavior for both the
  1440 x 900 reference viewport and the 1100 x 680 supported minimum.
- Redesign project/session discovery and management, including running,
  waiting, completed, failed, unread, loading, selected, and released-runtime
  states without removing persisted sessions from navigation.
- Redesign the conversation surface for live streaming, completed turns,
  reasoning, tool calls, Bash, subagents, extension messages, errors, retry,
  queue, steer, notifications, and per-turn actions.
- Redesign the Composer as one stable keyboard-first interaction surface,
  including attachments, `/` commands and skills, `@` files and skills,
  queue/steer controls, send-key preference, disabled states, and pending
  content preservation.
- Redesign the Inspector's Files, continuous Changes, Conversation outline,
  subagent detail, and Terminal experiences without duplicating source data or
  exposing raw protocol records.
- Redesign Settings, model/provider management, Integrations, package/resource
  management, MCP structured editing, and raw JSON/JSONC escape hatches around
  task-oriented workflows rather than configuration dumps.
- Define a consistent system for loading, empty, ready, error, unavailable,
  confirmation, destructive action, progress, and notification states.
- Preserve light/dark themes, density settings, reduced motion, bilingual
  localization, accessible focus/semantics, and existing security boundaries.
- Prefer existing tokens, primitives, Tabler/react-icons, official Pi
  projections, and current Main/preload/renderer ownership. Any new primitive
  or contract must remove meaningful duplication or enable a required UX.
- Produce current-worktree visual evidence before finalizing the redesign and
  validate the implemented result in the real Electron application.

## Acceptance Criteria

- [x] Every top-level surface has a documented purpose, entry point, return
      path, and relationship to the persistent conversation state.
- [x] The primary daily flow from project/session selection through prompt,
      live execution, inspection, and completion is usable without ambiguous
      status or stale content.
- [x] Session switching never flashes the previous transcript or Inspector data
      and presents one stable loading-to-ready transition.
- [x] Running, queued, waiting, completed, and failed work can be identified
      from navigation and understood in the conversation without opening raw
      protocol data.
- [x] Composer pickers and queue/steer flows are fully keyboard operable and do
      not lose text, attachments, or focus.
- [x] Tool, Bash, subagent, reasoning, notification, error, and retry content is
      progressively disclosed with readable summaries and accessible details.
- [x] Files, Changes, outline, subagent details, and Terminal remain usable in
      direct context with the conversation: persistent beside it at wide
      sizes and available as an on-demand detail layer at the supported
      minimum size.
- [x] Model, package, MCP, and settings workflows expose common operations in
      structured UI while preserving advanced raw editing where already
      required.
- [x] Loading, empty, error, unavailable, destructive, selected, hover, focus,
      disabled, and success states are consistent across the product.
- [x] The redesign works in Chinese and English, light and dark themes, normal
      and reduced motion, and at 1440 x 900 and 1100 x 680 without page-level
      horizontal scrolling or overlapping controls.
- [x] All changed workflows have focused automated coverage and are visually
      inspected in a freshly built Electron application.

## Out Of Scope

- Replacing the official Pi SDK or moving Pi/Main-owned state into Renderer.
- Inventing capabilities that installed Pi packages or existing adapters do
  not expose.
- Copying Codex branding, proprietary implementation details, or platform-
  specific behavior that conflicts with PiPilot's desktop architecture.
- Adding a second visual system, icon family, or overlapping component
  library.

## Key Decisions

- The product is conversation-first. Projects organize the Session list and do
  not replace the central conversation with dashboards.
- The primary rail has Conversations and Settings/Management. Activity and
  Integrations are not separate top-level destinations.
- Settings/Management is a focused workspace without the conversation
  Inspector. Returning to Conversations restores the prior live state.
- Wide layouts keep the Inspector beside the conversation. At the supported
  minimum width it becomes an on-demand detail layer so the conversation and
  configuration content are never compressed into unusable columns.
- Codex is an interaction reference for hierarchy and progressive disclosure,
  not a visual brand to copy. PiPilot keeps its current tokens, icon family,
  density, and desktop-tool character.
- This remains one coherent task with ordered review gates because frame,
  conversation, Composer, Inspector, and management routing share the same App
  composition and state-restoration contract.

## Notes

- This is a complex task and requires `design.md`, `implement.md`, current
  visual evidence, and curated implementation/check context before activation.
