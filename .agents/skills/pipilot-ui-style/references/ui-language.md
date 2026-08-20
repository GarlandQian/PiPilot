# PiPilot UI Language

This is the compact visual contract for PiPilot's renderer. It is grounded in
`PRODUCT.md`, the confirmed Command Center direction in
`.trellis/tasks/08-11-ui-redesign-command-center/`, the conversation-outline
design in `.trellis/tasks/08-10-pi-session-jump-navigation/`, and the live
tokens in `src/styles/globals.css` and `src/lib/theme.tsx`.

## Product Shape

PiPilot is a local desktop client for the user's official Pi coding agent. Its
users are developers who keep a desktop window open for hours while they pick
sessions, converse, inspect tool output, review diffs, use a terminal, and
occasionally edit MCP configuration. The interface should feel like a working
command center, not a marketing page or a generic cloud chat client.

The confirmed frame is:

```text
48px activity rail | contextual panel | main work surface | right inspector
-------------------------------------------------------------------------
26px status bar spanning the frame
```

The 08-11 design keeps chat mounted while Integrations or Settings is active,
so switching surfaces does not discard draft, stream, or scroll state. The
inspector remains a parallel, collapsible surface. The minimum supported window
is 1100 x 680; the primary desktop reference is 1440 x 900.

## Principles

1. **Structure over decoration.** Hierarchy comes from columns, hairline
   borders, alignment, whitespace, and type. Do not add gradients,
   glassmorphism, neon, bokeh, decorative shadows, or oversized hero sections.
2. **One accent.** Neutral gray surfaces carry the interface. Sage is the only
   low-saturation accent and should signal active, selected, ready, or primary
   action states rather than decorate every row.
3. **Compact by default.** Dense rows and short controls support repeated
   developer workflows. Comfortable density is a user setting, not a separate
   visual theme.
4. **Pi owns truth.** Runtime, model, session, context, MCP capability, and
   transcript state come from existing official projections and adapters. Show
   honest loading, empty, unavailable, and error states.
5. **Keyboard is a first-class path.** Every frequent action has native focus,
   a visible focus ring, and a pointer-equivalent route. Preserve focus after
   selection and navigation.

## Token Vocabulary

Use the live variables rather than duplicating literal colors or dimensions.
Values below are the current evidence, not permission to bypass the token
system if the project changes them.

| Concern | Light | Dark | Use |
| --- | --- | --- | --- |
| App background | `--color-background` `hsl(220 13% 96%)` | `hsl(240 6% 8.5%)` | outer frame and empty space |
| Surface | `--color-surface` `hsl(220 14% 98.5%)` | `hsl(240 6% 11%)` | main work region |
| Sidebar | `--color-sidebar` `hsl(220 12% 93%)` | `hsl(240 6% 7%)` | rail/context/terminal backing |
| Border | `--color-border` `hsl(220 9% 84%)` | `hsl(240 5% 22%)` | separators and field edges |
| Muted text | `--color-muted-foreground` | same token | captions, metadata, helper text |
| Accent | `--color-sage` `hsl(172 32% 34%)` | `hsl(172 26% 62%)` | active indicator and primary action |
| Focus | `--color-ring` | `--color-ring` | `focus-visible:focus-ring` |

The radius scale is `--radius-sm: 6px`, `--radius-md: 8px`, and
`--radius-lg: 10px`; `--radius` is the legacy `md` alias. Motion uses
`--duration-fast: 120ms`, `--duration-base: 180ms`, and `--ease-standard`.
The reduced-motion setting and media query collapse motion durations and set
scroll behavior to automatic.

Appearance settings dynamically apply `--font-sans`, `--font-mono`,
`--app-font-size`, `--app-caption-size`, `--app-title-size`,
`--code-font-size`, `--control-h`, `--row-h`, `--tool-row-h`, and
`--tree-row-h`. Do not scale type with viewport width.

## Typography And Density

- UI labels use the configured sans stack: Inter/SF Pro/Segoe UI with Chinese
  fallbacks already defined in `globals.css`.
- Model IDs, providers, branches, paths, code, and terminal output use the
  configured mono stack.
- Use the existing `text-title`, `text-body`, `text-caption`, `text-micro`,
  and `text-code` classes where they fit. Keep panel headings compact and
  reserve larger type for the main surface title.
- Let long localized labels wrap or truncate within a bounded container. Never
  clip a control's meaning just to preserve one line.

## Controls And Iconography

Reuse `src/components/ui/` primitives. Use Tabler/react-icons already used by
the renderer; icons are stroke-based, small, and paired with a tooltip when
their meaning is not obvious. A familiar symbol (close, refresh, copy, send,
collapse, palette) can be icon-only; a destructive or ambiguous operation gets
an accessible text label or tooltip.

Use:

- segmented controls for mutually exclusive modes such as Form/JSON;
- switches and checkboxes for binary settings;
- menus/selects for option sets;
- sliders/inputs/steppers for numeric settings;
- semantic tabs for sibling inspector or integrations views;
- `Button`, `Dialog`, `Command`, `Tooltip`, and form primitives instead of
  hand-rolled interaction shells.

Do not turn every label into a pill, use rounded text rectangles where an icon
would be clearer, or add a new icon library for a single action.

## Content And State

Visible strings live in `src/i18n/locales/en-US.json` and `zh-CN.json` with
matching keys. Keep copy direct and operational: identify the current surface,
what is available, and what action is possible. Avoid feature-tour prose,
claims about capabilities that Pi has not reported, or user data in fixtures.

For session-owned content, the renderer must not show stale outline/transcript
items while scope, official session ID, runtime generation, and hydration do
not agree. The Conversation outline is a flat latest-first list of visible
user-led turns, with bounded prompt/summary text and no raw protocol IDs. Missing
provenance or an unavailable anchor is an honest omission, not an invitation to
guess from text or array position.

Every substantial surface needs stable empty, loading, error, and (where
relevant) unavailable states. Keep the state treatment centered and quiet. Do
not replace a truthful loading state with a skeleton that implies data has
already arrived.

## Responsive Rules

Design for the 1440 x 900 desktop frame and verify the 1100 x 680 minimum. Keep
the rail at 48px and preserve the main work surface's readable minimum. At the
minimum width, collapse or hide the inspector according to the existing frame
behavior rather than squeezing text and controls into overlap. Pickers and
dialogs must remain inside the viewport and match the Composer/editor width
where that is their contract.

Use stable grid tracks, aspect ratios, min/max constraints, or fixed control
heights so hover, focus, dynamic labels, and loading text cannot shift nearby
content. Check both themes and both locales whenever text or layout changes.

## Anti-Patterns

- generic three-pane chat styling that ignores the Command Center hierarchy;
- a second accent color used for decoration;
- gradients, glass, neon, ornamental shadows, giant cards, nested cards, or
  marketing hero copy;
- direct `window.pipilot` calls from a feature component or renderer filesystem
  access;
- raw session graph rows, raw IDs, hidden branches, or fake capability data;
- fixed English-width controls, unlocalized copy, or text that overlaps at
  minimum size;
- smooth scrolling/highlight animation that ignores reduced motion.
