# Current UX Audit

## Evidence

- Worktree commit: `bd54333a3aaae5ad18ac25468a092b1b2e44175c`
- Capture date: 2026-08-31
- Source: stable Electron Playwright fixtures produced from the release worktree
- These `test-results` images are temporary audit evidence, not approved
  long-term visual baselines.

Reviewed captures:

- `test-results/electron/pipilot.electron-runs-Comp-d648d-catalog-and-session-loading/composer-mentions-desktop-light.png`
- `test-results/electron/pipilot.electron-runs-Comp-d648d-catalog-and-session-loading/subagent-details-desktop-light.png`
- `test-results/electron/pipilot.electron-runs-Comp-d648d-catalog-and-session-loading/workspace-file-viewer-desktop-light.png`
- `test-results/electron/integrations.electron-mana-a5f13--across-responsive-Settings/integrations-overview-light.png`
- `test-results/electron/integrations.electron-mana-a5f13--across-responsive-Settings/integrations-minimum-dark.png`
- `test-results/electron/external-control-settings.-4f9c4-he-compact-Integrations-tab/external-control-ready-dark-zh.png`

Code evidence:

- `src/App.tsx`
- `src/components/frame/ActivityRail.tsx`
- `src/components/frame/ContextPanel.tsx`
- `src/components/frame/SessionsPanel.tsx`
- `src/components/layout/SessionList.tsx`
- `src/components/chat/MessageList.tsx`
- `src/components/chat/Composer.tsx`
- `src/components/chat/ToolCallCard.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/components/settings/IntegrationsSettings.tsx`
- `src/components/settings/ModelsSettings.tsx`
- `src/styles/globals.css`

## Confirmed Findings

### 1. The frame allocates columns by component, not by user task

The 48px rail, context panel, main surface, and Inspector remain peers across
Sessions, Settings, and Integrations. This is useful for conversation work but
produces unrelated or low-value Inspector content while configuring the app.
At the 1100 x 680 minimum, Settings navigation, an Integrations master/detail
layout, and the Inspector compete for width simultaneously.

Observed consequence: the Integrations package detail column becomes narrow
enough to wrap a path one character per line. This is a release-worktree UX
defect, not a visual preference.

### 2. Responsive behavior hides overflow without reprioritizing content

Current surfaces generally preserve every column and shrink descendants until
local narrow-mode thresholds apply. The frame needs explicit wide, compact,
and focus-mode compositions that decide which secondary panel becomes a
drawer/drill-in view, rather than relying only on truncation and local grids.

### 3. Conversation hierarchy is technically complete but visually flat

User messages, assistant prose, reasoning, tool rows, expanded Bash output,
subagent execution, timestamps, per-turn actions, and runtime status are all
present, but several layers use similar border, row, and text treatments.
Scanning a long-running session therefore requires parsing individual labels
instead of recognizing a consistent turn/timeline hierarchy.

The subagent Inspector proves that structured execution detail can be useful
as a contextual surface. The redesign should generalize this hierarchy without
making every tool open a permanent Inspector destination.

### 4. Composer owns too many controls without a clear primary state

The Composer supports messages, images, mentions, skills, commands, model and
thinking selection, queue/steer modes, pending messages, and stop/send actions.
The full-width picker is structurally correct but visually dominates the
conversation when open, while action meaning changes across idle and running
states. The redesign needs one stable input shell with explicit mode and
pending-state hierarchy.

### 5. Navigation exposes implementation grouping more than workflow grouping

The activity rail has Sessions, Integrations, and Settings; Integrations also
exists as a Settings section and then adds its own Overview, Packages,
Resources, MCP, and External Control tabs. This creates repeated navigation
levels and makes it unclear whether Integrations is a primary workspace or a
configuration category.

### 6. Structured settings have uneven density and progression

Overview pages are sparse, while package/model/MCP detail pages can become
dense master/detail editors. Common actions and advanced/raw paths share the
same visual weight. The redesign should organize these around task flow:
discover/select, inspect, edit/test, save/apply, and diagnose.

### 7. The current visual language should be retained

The neutral surfaces, single sage accent, compact typography, hairline borders,
tokenized density, Tabler icon family, and restrained motion are coherent and
match the confirmed PiPilot direction. The redesign should change information
architecture, hierarchy, and component recipes rather than replace the brand
language with a decorative theme.

## Design Problem

PiPilot currently has the necessary capabilities, but it presents them as a
set of concurrently visible components. The redesign must instead allocate
attention according to the user's current task while keeping conversation and
running work persistent in state.

## Confirmed Product Decision

The redesign is **conversation-first**:

- Sessions and live work are the home surface.
- Project identity remains visible context rather than the root navigation
  object.
- Inspection and configuration use task-specific workspaces while the
  conversation remains mounted and preserves stream, draft, and scroll state.
- Concurrent running/waiting work remains discoverable through a global
  activity affordance rather than replacing the home information architecture.

Project-first and activity-first were rejected as the dominant structure.

## Confirmed Navigation Decision

- Remove the duplicate top-level Integrations destination.
- Use one settings-and-management workspace with grouped navigation.
- Keep direct command-palette routes for Models, Packages, MCP, and other deep
  destinations.
- Hide the conversation Inspector while managing configuration and restore its
  prior state on return.
- Keep a running-activity entry in primary navigation, but use it to filter and
  focus conversations rather than replace the conversation with a dashboard.
