# Component Guidelines

## Current Component Shape

PiPilot uses named function components with explicit props. Feature components
compose local primitives and receive commands through callbacks. For example,
`src/components/chat/Composer.tsx` owns draft input state but receives model,
send, stop, and model-change operations as props.

Use a named props interface when it improves readability:

```ts
interface ComposerProps {
  status: AgentStatus
  onSend?: (text: string) => void | Promise<void>
}
```

Small private composition helpers can use inline prop types, as demonstrated by
`ElectronComposer` in `src/App.tsx`.

## Composition

- Reuse controls from `src/components/ui/` for buttons, dialogs, menus, tabs,
  tooltips, selects, and inputs when continuing the current design system.
- Extend variants in the primitive owner rather than repeating a long class set
  across feature components. `buttonVariants` in `ui/button.tsx` uses CVA.
- Keep domain behavior in the domain component and generic behavior in the
  primitive. `Composer` knows about agent status; `Button` does not.
- Use `cn()` from `src/lib/utils.ts` for conditional Tailwind classes.

## Interaction And Text

- Controlled form elements use local state and explicit handlers.
- Icon-only controls in current code have an `aria-label`; decorative icons use
  `aria-hidden`. `Composer.tsx` is the main reference.
- Current localized components call `useT()` and use keys from
  `src/i18n/locales/en-US.json` and `zh-CN.json`.
- Async callback props may return `void | Promise<void>`; event handlers invoke
  them with `void` when the result is deliberately not awaited.

## Config Surfaces (Form|JSON Single Draft)

Settings surfaces that edit Pi-owned JSONC files (MCP servers, models.json)
keep ONE raw draft string as the source of truth. Form edits apply
path-targeted JSONC modifications that preserve comments and unknown fields;
the JSON view edits the same text directly. Switching views never saves,
rebuilds, or reformats. Invalid JSON blocks Save but keeps the draft.
Capabilities the form cannot represent are gated by `structured*Supported`
predicates and marked "JSON only" rather than silently dropping fields.
Dialogs compose `ui/form.tsx` primitives (`FormDialog`/`FormRow`/
`KeyValueRows`) with dirty-close confirmation, and secret fields are
write-only (blank keeps the stored value; an explicit control clears it).

## Visual Changes

There is no active UI freeze. Layout, styling, primitives, tokens, and component
structure may change as part of an approved Trellis task. When retaining the
current look, follow neighboring Tailwind and token usage instead of duplicating
raw CSS values.

## Integrations External Control

External Control stays in the existing compact Integrations internal tab strip;
it is not a top-level destination or a nested-card dashboard. Reuse Switch,
Button, Dialog, status text, and existing focus/token patterns. Render the full
`disabled | enabling | ready | disabling | error | unavailable` state model,
token-free command/args, authenticated-client count, and bounded metadata-only
recent rows. Main provides an optional conversation label; components never
format a raw conversation/operation ID or fabricate a client label.

At the supported 1100x680 minimum, all five Integrations tabs fit without a
visible internal horizontal scrollbar. Local-only explanatory copy uses normal
caption wrapping; only the executable/path field uses mono/break-all. Disable
with authenticated clients requires the concise destructive confirmation.

## Stable Scope Actions

Actions that belong to a project or another stable scope must not disappear
because a child list changes between empty, populated, loading, or unavailable.
Keep the same action in a stable scope-owned menu or control and route it through
the existing reviewed callback. Empty-state shortcuts may duplicate that route,
but they must not be its only entry point.

For project conversations, the stable New session action must remain available
when sessions already exist. Do not manufacture a second lifecycle path merely
to expose the action; reuse the same project-scoped creation callback used by
the empty state.

## Avoid

- Calling `window.pipilot` directly from a feature component.
- Recreating an existing primitive inside a feature folder.
- Using array indexes as keys when a model ID, message ID, path, or tool-call ID
  is available.
- Hiding a rejected Promise without deciding how the UI should represent it.
- Reading the External Control descriptor/token or composing an MCP config in
  the component instead of rendering the Main-projected configuration.
