# PiPilot About Update Experience

## Goal

Present the Runtime child update contract in PiPilot's existing UI language so
users understand the current version, available update, platform trust limits,
and the exact action they can take.

## Dependencies

- Depends on `08-13-desktop-update-runtime` shared renderer snapshot/actions.
- Does not depend on public Release workflow implementation, but Electron visual
  fixtures must use the same capability matrix.

## Requirements

- Add one compact Application updates section under Settings → About; no new
  top-level navigation.
- Render every shared state honestly and clear stale version/progress/error data
  when its revision changes.
- Proven native states expose Download and explicit Restart and install. For
  `0.0.1`, Linux AppImage is native while macOS, Windows NSIS, and DEB expose
  Open GitHub Release.
- Show adjacent unsigned Windows and non-Developer-ID/not-notarized macOS
  warnings.
- Automatic discovery creates one dismissible non-blocking notice in the center
  work-surface notification region; persistent truth stays in About.
- Active-work install uses the existing confirmation dialog pattern.
- Use existing primitives/tokens/Tabler icons, bilingual locales, keyboard
  semantics, reduced motion, light/dark, and 1100×680 support.

## Acceptance Criteria

- [ ] Disabled/checking/current/available/downloading/downloaded/error states
      show only valid actions and no stale data.
- [ ] Mac/DEB never show a native install action.
- [ ] Windows warning and macOS trust warning are visible beside relevant action.
- [ ] Notification is dismissible, non-modal, centered in the work surface, and
      navigates to About without interrupting the active chat.
- [ ] All actions are keyboard reachable with visible focus; progress/error
      semantics are announced appropriately.
- [ ] en-US/zh-CN parity, both themes, reduced motion, and 1100×680 Electron
      screenshots/interaction pass.

## Out of Scope

- Parsing provider events, direct `window.pipilot` calls, a new Update page,
  marketing release notes, or changing PiPilot's overall visual system.
