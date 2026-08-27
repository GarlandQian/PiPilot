---
name: pipilot-ui-style
description: Use whenever designing, implementing, reviewing, or polishing PiPilot renderer UI, including Sidebar, Chat, Composer, Settings, Integrations, MCP, Inspector, Files, Changes, Outline, Terminal, Loading, Empty state, Error state, Responsive, Theme, Accessibility, UI review, and UI polish work. Apply this skill even when the request only mentions one control, state, or visual critique, so the result stays consistent with PiPilot's compact developer-tool language, token system, accessibility rules, and official Pi boundaries.
---

# PiPilot UI Style

Use this skill to make renderer UI feel like PiPilot: a calm, keyboard-first
desktop command center for developers who keep it open for long sessions. The
skill is for visual decisions and their implementation guidance. It does not
invent product capabilities, move data ownership into the renderer, or replace
the project's existing state and IPC contracts.

## Start Here

1. Read `references/ui-language.md` for the visual language, layout vocabulary,
   tokens, copy conventions, and non-negotiable constraints.
2. Read the relevant recipe in `references/component-recipes.md` before editing
   an existing surface. Use `references/visual-baseline.md` when the request affects a
   captured surface or when a screenshot comparison is useful.
3. Keep `references/review-checklist.md` beside the work. It is the completion
   gate for design reviews and UI implementation handoffs.

Treat the images in `assets/reference-ui/` as approved visual evidence. Compare
composition, density, hierarchy, and state treatment; do not copy fixture text,
session data, or machine-specific paths from a screenshot into production UI.

## Working Method

### 1. Identify the surface and truth source

Name the affected surface (frame, sessions, chat, Composer, inspector,
Integrations, settings, or a state variant) and state which existing component,
store, adapter, or official Pi projection owns its data. Keep renderer changes
inside existing preload-whitelisted boundaries. If a value comes from Pi or
Main, render its actual loading, ready, empty, missing, and error states rather
than a plausible placeholder.

### 2. Compose before decorating

Start with the structural hierarchy: activity rail/context panel, main work
surface, inspector, and status bar where applicable. Use borders, alignment,
spacing, and type to separate regions. Keep chat and inspector useful in
parallel. A section should be an unframed band or constrained layout; use a
card only for a genuinely framed tool, modal, or repeated item, and never put a
card inside another card.

### 3. Use the existing design system

Prefer semantic CSS variables (`--color-background`, `--color-surface`,
`--color-sidebar`, `--color-border`, `--color-muted-foreground`,
`--color-sage`, and the motion/radius tokens) over new literals. Reuse
`src/components/ui/` primitives and their keyboard/focus behavior. Extend a
primitive variant at its owner when a pattern repeats. Use the existing
Tabler/react-icons stroke set and tooltips for unfamiliar icon-only controls.

### 4. Keep the visual language restrained

- Use neutral gray surfaces with one low-saturation sage accent.
- Keep compact density as the default; let the appearance setting control
  comfortable density, font sizes, and reduced motion.
- Use system/UI text for labels and a mono face for model names, branches,
  code, paths, and protocol-shaped values.
- Prefer 6/8/10px radius tokens and hairline borders. Do not add gradients,
  glassmorphism, neon colors, decorative shadows, bokeh, or marketing hero
  composition.
- Keep headings proportional to their container. Do not use oversized display
  type in panels, inspectors, dialogs, or status bars.

### 5. Make frequent actions obvious and keyboard-complete

Use familiar icons for tool actions, icon-plus-text for clear commands, and
segmented controls for modes. Use native button/list semantics, visible focus,
Arrow/Home/End behavior where lists expose an order, and preserve focus after
menus, dialogs, and outline jumps. Respect `prefers-reduced-motion` and the
app's `data-reduced-motion` attribute.

### 6. Localize and bound content

Put every visible string in both locale catalogs. Write labels that survive
Chinese expansion and narrow desktop widths; never rely on a fixed text width.
Bound previews, summaries, and status labels before they enter component state.
Do not show raw session entry IDs, internal paths, protocol records, or hidden
branches in user-facing surfaces.

## Surface Guidance

- **Frame:** Keep navigation discoverable through the rail and command palette;
  contextual navigation belongs in the context panel. The status bar is a
  compact truth strip, not a second toolbar.
- **Sessions/chat:** Make session identity and the current prompt easy to scan.
  Preserve chronological transcript order. Composer controls should remain
  stable while pickers open and should not submit when a candidate is selected.
- **Inspector:** Keep Files, Changes, Conversation outline, and Terminal as
  sibling tabs. The outline is a flat latest-first view of visible turns; it is
  not a raw session-tree or shell surface.
- **Integrations/settings:** Use the shared form rhythm and honest capability
  states. For JSONC-backed settings, keep one draft text across Form and JSON;
  preserve comments and unknown fields and never render secrets.
- **Empty/loading/error:** Reuse the centered session-owned state treatment and
  clear stale content on scope/session/generation replacement.

## Review Output

When asked to design, propose a short hierarchy and a component/token mapping,
then call out states, keyboard behavior, i18n, and verification. When asked to
review, lead with concrete findings tied to a surface or recipe, ordered by
severity, and distinguish visual preference from a contract or accessibility
defect. Cite the relevant reference file and screenshot filename when useful.

Before finishing, run the smallest relevant check (often `pnpm typecheck`, a
focused test, `pnpm build`, or a screenshot inspection) and report exactly what
was run. Do not claim a screenshot, build, integration, or test passed unless it
was exercised in the current worktree.
