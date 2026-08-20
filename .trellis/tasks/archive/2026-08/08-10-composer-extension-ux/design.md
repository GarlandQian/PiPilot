# Technical Design

## Candidate Model

Create one presentation shell and one pure navigation model; retain source-
specific candidate projection and insertion logic.

```ts
type ComposerPickerRow =
  | { kind: 'heading'; id: string; label: string }
  | { kind: 'status'; id: string; state: 'loading' | 'empty' | 'error' }
  | { kind: 'option'; id: string; group: 'commands' | 'files' | 'skills';
      disabled: boolean; label: string; description?: string; meta?: string }

type ComposerPickerNavigation = {
  activeId: string | null
  selectableIds: readonly string[]
}
```

A pure transition helper reconciles asynchronous row replacement and handles
first/last selection, wrapping, movement, activation, and dismissal. Components
render stable IDs and scroll the active option after movement. The editor keeps
focus and owns keyboard events.

## Slash Projection

Replace the `SkillPickerLevel` state machine with a flat projection: official
non-Skill commands first, authoritative installed Skills second. One editor
query filters both. Exact official command/Skill validation, collision handling,
and insertion/submission semantics remain in renderer helpers rather than the
visual component.

There is no `skills-navigation` option, child search field, or Back action.
`/skills` may still exist if Pi itself advertises a real command with that name,
but PiPilot no longer invents it as UI navigation.

## Mention Projection

Tiptap Suggestion continues owning typed `@` range, revision, and query. The
Files and Skills candidate sets feed the shared shell. Selection delegates to
the existing exact trusted atom insertion path.

Remove `TbAt`, the toolbar trigger button, the editor handle used only to insert
a synthetic trigger, toolbar-origin plugin state, selection replacement/
restoration, and tests specific to that entry path. Keep paste/copy/cut, image
attachment, history reset, and scope reset.

## Generic Extension Surfaces

Presentation classification distinguishes built-in read/edit/bash tools from an
unknown extension tool. A generic card receives sanitized bounded arguments and
result fragments; it owns no extension semantics. The active activity strip
projects existing string statuses/widgets with source identity and collapsed/
expanded state. It clears on the same generation/session readiness boundary as
the Composer.

Notifications are mounted inside the conversation `<main>` positioning
context. The host is absolute `top/right` relative to that column, bounded to
its available width, pointer-transparent outside notification surfaces, above
the transcript and below popovers/dialogs.

## State Boundaries

- Picker state is component-local and keyed by scope/session/runtime catalog
  identity.
- Tool and active extension projection is provider-owned because it follows
  official generation-tagged events.
- Notification/widget/status rendering consumes provider state; it does not
  duplicate event subscriptions.
- Plan/Retry may later supply typed activity items through the generic activity
  host, but this child does not recognize package names.

## Rollback

The shared shell/navigation and toolbar-trigger removal are one Composer
rollback unit. Generic tool/activity presentation and notification placement are
independent renderer rollback units. No persisted data or Main contract changes
are required.
