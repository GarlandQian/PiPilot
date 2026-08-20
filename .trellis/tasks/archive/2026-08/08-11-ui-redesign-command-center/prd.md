# Redesign PiPilot UI as Command Center

## Goal

Replace the current default-looking three-pane AI-client UI with a
keyboard-first "Command Center" product experience (user-selected Direction
B, 2026-08-11): a 48px activity rail, a contextual second panel, a slim
content header, a persistent bottom status bar, and a ⌘K command palette as
the primary navigation mechanism. The redesign covers the whole renderer:
app frame, navigation, sessions, chat, inspector, settings, and the MCP
editing surface. Existing functionality, data flow, IPC boundaries, and
Pi contracts are preserved; only the renderer's presentation and
information architecture change.

## Confirmed Facts

- Direction B was chosen by the user over a refined three-pane (A) and a
  tabbed console (C). C was rejected in part because chat and diff/terminal
  must remain visible in parallel.
- Visual constraints are binding (PRODUCT.md): neutral gray surfaces,
  exactly one low-saturation accent (current sage may be refined or
  replaced within that constraint), no gradients/glass/neon/decorative
  shadows, Tabler stroke icons, compact-by-default density.
- Token system already exists (`globals.css` + `lib/theme.tsx`): theme,
  font families/sizes, density, reduced motion all apply via CSS variables
  without reload. New design must keep this mechanism.
- shadcn/Radix primitives in `src/components/ui/` may be restyled or
  replaced, but their behavioral APIs (keyboard, focus, aria) are assets.
- All user-visible text must live in `src/i18n/locales/{zh-CN,en-US}.json`,
  keys kept in parity (flat dotted keys; types derive from zh-CN).
- MCP structured-form requirements are owned by task
  `08-10-local-pi-integrations-manager` (updated in this planning round);
  this task supplies the shared dialog/form primitives and the visual
  language that surface adopts.
- Electron security boundary is fixed: renderer keeps using
  preload-whitelisted IPC only; no new channels for pure UI work.

## Requirements

### R1 Application frame

- 48px left activity rail with at most 5 destinations (exact set resolved
  in design; candidates: Sessions, Integrations, Settings), icon-only with
  tooltips, active indicator, full keyboard access.
- Second column is a contextual panel whose content follows the active
  rail destination (session list, integrations sub-nav, settings nav).
- Bottom status bar (~26px) shows: Pi runtime state, active model, git
  branch, context usage with threshold coloring, MCP adapter state. Each
  segment is clickable to its relevant surface/action where sensible.
- Chat header slims to title + session actions; status information moves
  to the status bar.
- Settings becomes a main-area surface reached from the rail; entering it
  no longer destroys chat view state.

### R2 Command palette

- ⌘K / Ctrl+K opens a command palette: fuzzy session switching, core
  actions (new session, toggle panels, change model, open settings
  section, jump to integrations), complete keyboard operation, list
  virtualization not required at current scale, reduced-motion aware.
- Palette is the documented primary navigation; all its actions must also
  remain reachable by pointer.

### R3 Design tokens and primitives

- New token scale in `globals.css` (color steps, spacing, radii, motion
  durations/curves, focus ring) for dark and light; density keeps driving
  control/row heights.
- Restyle `src/components/ui/` primitives in place; replace only when a
  primitive blocks the design. Justify any new dependency before adding.
- Establish a reusable wide-dialog/form pattern (title top-left, close
  top-right, footer actions, right-aligned label column option, dynamic
  row primitives) that the MCP form consumes.

### R4 Surface restyle

- Sessions panel: grouped by project, search, status-aware rows, kept
  capabilities (rename, delete, jump).
- Chat: message list, composer, tool cards, approval card, markdown and
  code blocks restyled to new tokens; streaming behavior preserved.
- Inspector: remains a right-side collapsible panel (default disposition;
  see Open Questions), tabs restyled, resize handle kept.
- Settings: sections keep their content model but adopt the new form
  rhythm and density; Integrations keeps its list/detail workspace.

### R5 Accessibility and i18n

- Every new control has labels/aria-labels, visible focus, and full
  keyboard reachability; reduced motion removes non-essential animation.
- All new strings added to both locales with parity; no fixed text-width
  layout assumptions.

### R6 Verification (deferred to the user this round)

- After implementation, the user runs: `pnpm typecheck`, focused MCP
  Vitest suites, `pnpm build`, MCP/Integrations Electron Playwright flows,
  and manual dark/light × wide/narrow screenshot review.
- No new tests for pure styling; focused regression tests only if form
  transforms or JSONC persistence logic change (owned by the MCP task).

## Acceptance Criteria

- [ ] Activity rail + contextual panel + status bar + command palette are
      the live navigation; old sidebar/settings-replace-chat navigation is
      gone.
- [ ] No surface mixes the old visual system with the new one; all colors,
      spacing, radii, and motion come from the new token scale.
- [ ] Chat and inspector remain visible in parallel; inspector collapse is
      keyboard-reachable.
- [ ] Status bar truthfully shows runtime/model/branch/context/MCP state.
- [ ] Command palette performs its documented actions by keyboard alone.
- [ ] Dark and light themes, compact and comfortable densities, and both
      locales render without overflow, overlap, or hard-coded colors.
- [ ] MCP surface adopts the shared wide-dialog form primitives from this
      redesign (detailed behavior per the MCP task's PRD).
- [ ] `pnpm typecheck` and `pnpm build` pass (final verification by user).

## Out Of Scope

- MCP form behavioral requirements, parser/service/IPC changes (owned by
  `08-10-local-pi-integrations-manager`).
- Any new Electron IPC channels, preload surface changes, or main-process
  work.
- New features beyond re-presentation (no marketplace, presets, telemetry,
  cloud accounts).
- Marketing-style surfaces, onboarding tours, changelog viewers.
- Committing changes (Phase 3.4 happens after user verification).

## Decisions (2026-08-11, user-confirmed)

- Rail destinations: **Sessions / Integrations / Settings** (3 items).
  Files/Terminal remain Inspector tabs; the Inspector stays a right-side
  collapsible, resizable panel. Chat and Inspector remain visible in
  parallel.
- Accent hue: keep **sage** (refined values allowed; no hue change).
