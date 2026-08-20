# Composer and generic extension UX

## Goal

Unify slash and mention pickers, remove the mention toolbar trigger, improve keyboard navigation, and present generic extension tools/activity/notifications in the conversation column.

## Parent And Dependency

- Parent: `08-10-mcp-session-runtime-ux`.
- No implementation dependency. Parent integration verification waits for
  `08-10-runtime-session-reliability` so stale-session behavior is tested on the
  final readiness contract.
- This child must publish the generic activity contract before
  `08-10-plan-retry-adapters` starts.

## Requirements

### Unified Composer candidates

- `/` opens one compact Codex-style surface containing Commands and installed
  Skills immediately; remove the `/skills` second level, Back action, and
  separate query input.
- Typed `@` opens the same shell with Files and Skills. Do not repeat the query
  in a decorative header.
- Remove the toolbar `@` button and all synthetic-trigger lifecycle code. Keep
  attachment/paperclip behavior unchanged.
- ArrowUp/ArrowDown/Enter/Escape must work across visible enabled groups with
  wrapping, disabled/status-row skipping, scroll following, and one controlled
  active option.
- Preserve editor focus, typed text, Tiptap suggestion identity, clipboard,
  IME/keyCode-229 handling, asynchronous source isolation, and scope/session/
  generation reset.
- Use the existing Tabler icon family and stable dimensions on desktop and
  narrow layouts.

### Generic extension presentation

- Unknown extension tools use a neutral typed tool card with bounded arguments,
  result, progress, duration, error, and Copy. Do not label them as shell.
- Current string statuses/widgets use a compact collapsible activity strip
  above the Composer; completed tools stay with their assistant turn.
- Extension notifications live at the upper-right inside the middle
  conversation column, follow panel resizing, and do not cover header controls.
- Existing extension dialogs and exact notification semantics remain intact.
- Structured `subagent` calls/results use the generic tool card only. Do not
  expose fleet or control actions that official external Pi RPC cannot reach.
- No extension-specific parsing, private imports, notification-text scraping,
  or TUI component emulation belongs in this child.

## Acceptance Criteria

- [ ] `/` directly shows and filters Commands and Skills with no nested Skill
      screen.
- [ ] `@` directly shows and filters Files and Skills; no toolbar `@` control or
      hidden synthetic-trigger state remains.
- [ ] Keyboard-only flows cross group boundaries, wrap, skip non-options, keep
      a real ARIA active descendant visible, and never activate during IME.
- [ ] Pointer hover and keyboard movement update the same active option.
- [ ] Long names/paths truncate inside one shared compact picker without moving
      the Composer on desktop or narrow light/dark layouts.
- [ ] Generic tools no longer appear as shell commands and remain bounded and
      copyable.
- [ ] Status/widgets are collapsible above the Composer; notifications stay in
      the middle column through sidebar/inspector resizing.
- [ ] Session/generation replacement clears stale candidates, activity, and
      notifications.
- [ ] `pi-subagents` output remains readable generically without unsupported
      fleet controls.
- [ ] Focused unit/i18n tests, typecheck, build, and the Composer/extension
      Electron workflow pass.

## Out Of Scope

- Plan Mode or Retry semantic adapters.
- A permanent Plugins/Agent inspector tab for generic extension output.
- `ui.custom()`, TUI themes, custom headers/footers/editors, or shortcut
  emulation.
- Subagent fleet/status/control adaptation.
- Package installation or resource management.
