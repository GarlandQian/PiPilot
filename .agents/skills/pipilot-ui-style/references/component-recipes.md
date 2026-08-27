# Component Recipes

These recipes map common PiPilot UI requests to the existing component and
token boundaries. Read the recipe before introducing a new surface or control.

## App Frame

**Use when:** changing primary navigation, panel disposition, status, or the
desktop shell.

**Compose:**

- `src/components/frame/ActivityRail.tsx` for Sessions, Integrations, Settings,
  the command palette, and context-panel toggle;
- `src/components/frame/ContextPanel.tsx` for destination-specific navigation;
- the main surface owned by `src/App.tsx`;
- `src/components/inspector/InspectorPanel.tsx` for the right-side sibling
  tabs;
- `src/components/frame/StatusBar.tsx` for runtime/model/branch/context/MCP
  truth;
- `src/components/frame/CommandPalette.tsx` for ⌘K/Ctrl+K actions.

Keep frame navigation state in `App` when it must survive surface switches. Do
not unmount chat just because Settings or Integrations is active. Use the
existing panel resize/collapse behavior and preserve the 1100px minimum width.

## Sessions And Chat

**Use when:** changing session rows, the transcript, message actions, or the
Composer.

`src/components/frame/SessionsPanel.tsx` and
`src/components/layout/SessionList.tsx` own session navigation composition;
`src/components/chat/MessageList.tsx` owns transcript rendering and exact
source-entry anchors; `src/components/chat/Composer.tsx` and
`ComposerEditor.tsx` own draft editing and submission presentation.

Keep chronological transcript order. Use stable domain identities for React
keys and navigation; never match a destination by visible text, timestamp, or
array index. The Composer's official command projection is the source for
slash candidates, and Main's workspace search is the source for path mentions.
Pickers are transient, keyboard navigable, and non-submitting on selection.

## Inspector And Conversation Outline

**Use when:** adding or reviewing Files, Changes, Conversation outline, or
Terminal behavior.

`InspectorPanel` owns the tab shell and panel disposition. Use
`ConversationOutlinePanel` for a flat list of hydrated visible turns. The
outline is rendered latest-first by reversing a copy of chronological data;
the transcript itself is never reversed. A jump request contains the active
session/generation key, an official source entry ID, and a sequence number so a
repeat activation is observable. `MessageList` registers the matching anchor,
disables follow-to-bottom before scrolling, highlights briefly, and ignores a
late request after session replacement.

Keep Terminal available as the manual shell surface. Removing a renderer-only
Pi Shell is not permission to remove shared/Main official `bash`,
`abort_bash`, or `get_tree` protocol support.

## Integrations And MCP

**Use when:** changing Integrations overview, package/resource lists, MCP
structured editing, or JSONC states.

The Integrations workspace and settings components are the domain surfaces;
`src/components/settings/McpServerFormDialog.tsx` composes the shared form
primitives in `src/components/ui/form.tsx`. Keep one raw draft text across Form
and JSON views. Form edits apply targeted JSONC edits that preserve comments and
unknown fields; JSON edits replace the same draft. Invalid JSON blocks Save but
keeps the draft. Do not render secrets or claim `pi-mcp-adapter` is Pi core.

Use the existing global/project scope controls and honest adapter states. A
missing adapter should be visible as missing, not replaced by demo data.

## Settings And Forms

Use `SettingsLayout.tsx` for settings composition and existing controls for
appearance, language, model, terminal, and general settings. For a new form,
prefer `FormDialog`, `FormRow`, `DynamicRows`, and `KeyValueRows` over a custom
grid. Keep labels and hints localizable; use a right-aligned label column only
when the dialog width supports it, and stack below the documented narrow
breakpoint.

Dirty-close confirmation belongs to the consumer. Secret fields are write-only:
blank means keep the stored value, and an explicit clear action is required to
remove it. Do not serialize a masked value back into a Pi-owned document.

## Primitives And Styling

Reuse `Button`, `Input`, `Tabs`, `Command`, `Dialog`, `Tooltip`, `Select`,
`Switch`, and `Badge`. Put repeated visual variants in the primitive owner;
keep feature-specific data and behavior in the feature component. Use `cn()`
for conditional classes and tokenized Tailwind utilities (`bg-surface`,
`border-border`, `text-muted-foreground`, `focus-visible:focus-ring`).

Use semantic elements and ARIA labels before adding a custom keyboard handler.
If a custom handler is needed, document the visual order and preserve native
Enter/Space behavior. Respect the global reduced-motion attributes.

## State Recipe

For any session-owned or adapter-backed surface, model the visible state before
styling it:

```text
unavailable | loading | ready-empty | ready-content | error
```

Clear or hide old content when scope, session, generation, or hydration changes.
Bound summaries and result lists. A failed optional adapter or missing anchor
should degrade locally and explain the limitation without a global modal unless
the owning contract requires one.

## Verification Recipe

Run the smallest relevant check after the batch of edits: focused unit test for
pure projection/state, `pnpm typecheck` for shared renderer types, `pnpm build`
for bundle/layout integration, and the relevant Electron Playwright scenario
for desktop behavior. Inspect a matching light/dark or minimum-window
screenshot when geometry or visual hierarchy changed. Report only commands and
outcomes actually observed.
