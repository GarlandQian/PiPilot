# Design — Command Center UI Redesign

Direction B, user-confirmed 2026-08-11. Renderer-only re-presentation; no
IPC, preload, main-process, or Pi contract changes.

## 1. Navigation model

Replaces `view: 'chat' | 'settings'` with a frame state:

```ts
type RailDestination = 'sessions' | 'integrations' | 'settings'

interface FrameNav {
  rail: RailDestination        // active destination
  contextPanelOpen: boolean    // ⌘B
  inspectorOpen: boolean       // ⌘J (existing)
  paletteOpen: boolean         // ⌘K
}
```

- `rail: 'sessions'` → main area shows chat; context panel shows the
  workspace/projects/session lists (today's Sidebar body).
- `rail: 'integrations'` → main area shows the Integrations workspace
  (list/detail); context panel shows its sub-nav (Overview, MCP).
- `rail: 'settings'` → main area shows the active settings section;
  context panel shows the settings section nav (7 items).
- **Chat stays mounted**: when integrations/settings are active, the chat
  subtree is hidden with `display: none`, not unmounted. Scroll position,
  streaming state, composer draft, and pending approvals survive surface
  switches. Tradeoff: one extra mounted subtree (acceptable; it is the
  app's core state).
- `settingsSection` / `integrationsTab` state stays in App; switching rail
  to sessions and back restores the same section.

## 2. Layout grid

```
┌──────┬───────────────┬────────────────────┬──────────────────┐
│ rail │ context panel │ main surface       │ inspector        │
│ 48px │ 240px, ⌘B     │ flex-1             │ 280–480px, ⌘J    │
├──────┴───────────────┴────────────────────┴──────────────────┤
│ status bar, 26px, full width                                 │
└──────────────────────────────────────────────────────────────┘
```

Minimum window width stays 1100px; below that the inspector
auto-collapses instead of crushing the main column.

## 3. New components (`src/components/frame/`)

| Component | Responsibility |
| --- | --- |
| `ActivityRail.tsx` | π logo (top), 3 destination buttons (icon + tooltip + aria-label, active indicator bar), bottom: command palette button with ⌘K hint, panel collapse toggle. Full keyboard operation (tab stop per button, ⌘1/2/3). |
| `ContextPanel.tsx` | 240px column hosting one of three panel bodies by rail destination; header row shows the destination label + panel-specific action (e.g. New Session). |
| `StatusBar.tsx` | Segmented bottom bar; see §5. |
| `CommandPalette.tsx` | Dialog + existing `ui/command` (cmdk 1.1.1 already installed); see §6. |

`Sidebar.tsx` is dismantled: its body composition moves into
`ContextPanel` (sessions body), its settings entries are replaced by rail
destinations. `SessionList.tsx` keeps its API and gains project grouping
headers (existing `expandedProjects` state moves from App into the panel;
App keeps only the callbacks it already owns).

## 4. Settings as a main-area surface

- `SettingsLayout.tsx` loses its left nav column (nav moves to
  `ContextPanel` when `rail === 'settings'`) and keeps the content column,
  restyled with the new form rhythm (§8).
- Integrations keeps `IntegrationsWorkspace` (list/detail) as the main
  surface; its in-surface section headers stay.
- No content model changes in any settings section in this task except
  the MCP form (§9).

## 5. Status bar data wiring

All read-only from existing stores; no new IPC.

| Segment | Source | Click action |
| --- | --- | --- |
| Runtime state dot + label | `usePiRuntime()` state (starting/ready/error) | none (tooltip explains) |
| Model | `pi.models` current selection | opens model menu (same list as Composer) |
| Branch | `useWorkspaceStore()` workspace branch | none |
| Context usage | session state `contextUsage` (shared schema `local-pi.ts`) with >80% warning coloring | none (tooltip with exact numbers) |
| MCP adapter | `useMcpStore()` adapterStatus | navigates to rail `integrations` |

Left-to-right order: runtime · model · branch · context — MCP pinned to
the right end. Separator dots between segments; 12px caption text;
`role="status"` on the runtime segment only (avoid noisy live regions).

## 6. Command palette

- `src/lib/commands.ts`: a command registry — `{ id, titleKey, hintKey?,
  shortcut?, run(ctx) }`. Static commands: new session, toggle context
  panel, toggle inspector, go to sessions/integrations/settings, open each
  settings section, stop generation (when running). Dynamic entries: one
  per session (title + project group label) for jump-switching.
- Fuzzy matching is cmdk's built-in; no virtualization (session counts are
  small); grouped list (Actions / Sessions / Settings); reduced-motion
  removes the dialog scale/fade.
- Palette runs inside `TooltipProvider`/`Dialog`; focus returns to the
  previously focused element on close (Radix default).
- Every palette action is also reachable by pointer (PRD R2).

## 7. Keyboard map (global handler already in App)

| Keys | Action |
| --- | --- |
| ⌘K / Ctrl+K | command palette |
| ⌘B / Ctrl+B | toggle context panel (replaces sidebar toggle) |
| ⌘J / Ctrl+J | toggle inspector (unchanged) |
| ⌘1 / ⌘2 / ⌘3 | rail: sessions / integrations / settings |
| Enter / Esc | approval approve/deny (unchanged, still guarded against editable targets) |

`Ctrl+.` working-state debug shortcut is removed (debug-only leftover).

## 8. Tokens and primitives

**Token plan** (`src/styles/globals.css`): keep every existing CSS
variable name so all components keep compiling; revise values and add:

- Recalibrated neutral steps for both themes (sidebar/panel/main/editor
  separation stays background + hairline, no shadows).
- Sage accent kept; light-mode accent darkened one step for AA contrast
  on white; `--color-sage-foreground` stays dark-on-sage.
- Explicit radius scale: `--radius-sm: 6px`, `--radius-md: 8px`,
  `--radius-lg: 10px` (today's single `--radius` retained as md alias).
- Motion tokens: `--duration-fast: 120ms`, `--duration-base: 180ms`,
  `--ease-standard`; `data-reduced-motion` zeroes them (existing hook).
- Focus ring: 2px `var(--color-ring)` with 1px offset, one shared
  `focus-ring` utility used by all primitives.

**Primitives** (`src/components/ui/*`): restyle in place, keep exports
and props. Formalize the ad-hoc soft badges already used in ToolCallCard
into `badgeVariants`: `soft-success | soft-warning | soft-danger |
soft-info`. `button` keeps its `accent` variant.

**New form primitives** (`src/components/ui/form.tsx`):

- `FormDialog` — 760px dialog: header (title left, X right), scrollable
  body, footer (Cancel + primary action right-aligned). Dirty-close
  confirmation is the consumer's job via `onOpenChange`.
- `FormRow` — right-aligned 160px label column + control + hint/error
  line (matches the reference screenshot rhythm); stacks vertically under
  520px dialog width.
- `DynamicRows` — ordered row list: each row = inputs + delete button;
  dashed add-slot after every row and at the end (add-at-index preserves
  order without drag). `KeyValueRows` specialization for env/headers.

## 9. MCP unified form + single-draft Form/JSON toggle

Behavioral requirements live in
`08-10-local-pi-integrations-manager/prd.md`; the UI work happens here
because it depends on §8 primitives. Contract, parser, service, and IPC
are untouched.

**Form**: `McpServerFormDialog` (settings/integrations) replaces both the
3-field Add dialog and the inline structured editor. Add and Edit are the
same component; name is a full row; transport is a segmented control
(stdio / HTTP); stdio shows command, ordered `DynamicRows` args,
`KeyValueRows` env, cwd; HTTP shows url + `KeyValueRows` headers;
`enabled` switch and optional `description` (remark semantics) for both.
Inline validation: duplicate names (case-insensitive against the current
scope), required command/url, URL shape, empty kv keys. Closing with
unsaved changes asks via AlertDialog. Secrets never render in the list
rows.

**Single draft across Form/JSON** — the one behavioral piece:

- The Integrations MCP workspace header gets a segmented `Form | JSON`
  toggle. Source of truth becomes one **draft text** (JSONC), initialized
  from the loaded document.
- Form edits produce a new draft via the existing comment-preserving
  `applyServerEdits(draftText, edits)` — switching Form→JSON therefore
  never re-serializes and preserves comments/unknown fields/formatting.
- JSON edits set the draft text directly (fully editable, never a
  preview). `structuredSupported()` gates whether the Form side is
  enabled for the current draft; unsupported drafts stay JSON-editable.
- Invalid JSON: diagnostics with exact line/column listed under the
  editor; Save blocked; draft preserved. (Inline editor markers would
  require a code editor component — deliberately out of scope.)
- Save / Save + Restart Pi, fingerprint conflict AlertDialog, and
  Global/Project scope behave exactly as today.
- The legacy `setStructuredServers` staged-edits path is replaced by the
  draft-text flow inside the adapter hook; a focused Vitest covers the
  draft-sync helpers (form→JSON→form round-trip preserves comments and
  unknown fields, invalid JSON blocks save but keeps draft).

## 10. i18n plan

New key namespaces in both catalogs (flat dotted keys, parity enforced):
`rail.*` (3), `palette.*` (~10), `statusbar.*` (~8), `mcp.form.*` (~20).
Existing keys reused where the surface is unchanged.

## 11. Risks and tradeoffs

- **Chat kept mounted**: hides rather than unmounts; if hidden-subtree
  effects (terminal fit, markdown observers) misbehave, audit
  `useEffect` visibility assumptions in MessageList/Terminal.
- **Draft-text as single MCP truth**: re-parses on each structured edit;
  documents are small (<100 servers), cost is negligible.
- **Rail with only 3 destinations**: resists VS Code pastiche; adding a
  4th destination later is a product decision, not assumed here.
- **Settings content mostly unchanged**: the redesign's perceived depth
  comes from frame + tokens; settings sections get rhythm/density only,
  not redesigns of their controls.
- **Scope boundary**: no Electron main/preload changes; no new
  dependencies (cmdk already present); no commits until the user's
  verification round.
