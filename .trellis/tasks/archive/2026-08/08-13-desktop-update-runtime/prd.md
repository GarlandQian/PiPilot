# Desktop Application Update Runtime and Contracts

## Goal

Create the Main-owned application update state machine and strict
Main/preload/renderer contracts required by the parent release task, without
adding presentation-specific UI.

## Dependencies

- No child-task dependency. This is the first implementation dependency for
  `08-13-github-actions-public-release` and `08-13-update-about-ui`.
- Parent decisions in `../08-13-github-actions-release-updates/prd.md` are
  authoritative for platform capabilities and interaction policy.

## Requirements

- The application version used by comparisons and fixtures is `0.0.1` for the
  first release.
- Add the exact current `electron-updater` production dependency after
  rechecking official docs and installed types.
- Define strict shared update snapshot/action/event schemas with bounded data,
  a monotonic revision, and platform capability (`native-install` or
  `manual-release`).
- Main owns provider selection:
  - Linux AppImage uses electron-updater;
  - macOS, unsigned Windows NSIS without native proof, and non-AppImage Linux
    packages use a public GitHub latest release checker and manual release URL;
  - development/unpackaged/unsupported contexts use a no-network disabled
    provider.
- Configure automatic checks, manual downloads, manual install, stable channel,
  no downgrade, and no automatic install on quit.
- Coalesce concurrent checks/downloads, reject stale provider events, clean up
  timers/listeners, and expose stable error codes rather than raw errors.
- Extend validated IPC, preload, PiPilot API, and a renderer provider/adapter.
- Refactor shutdown into one idempotent coordinator supporting normal quit and
  confirmed update install while preserving bounded Pi/runtime/terminal cleanup.
- Package/feed metadata contract must state exactly which files/capabilities
  the release child must generate.

## Acceptance Criteria

- [ ] Every valid state/capability combination parses; invalid combinations and
      uncloneable third-party values are rejected before IPC.
- [ ] Development and unpackaged tests cannot contact the production feed.
- [ ] Automatic check never begins a download; download/install require explicit
      actions.
- [ ] Concurrent requests coalesce or return typed busy outcomes; stale events
      cannot overwrite a newer revision.
- [ ] macOS and unproven unsigned Windows expose manual release only; Linux
      native capability is enabled only for the approved AppImage target.
- [ ] Install requires a downloaded update and a second confirmation when Pi or
      terminal work is active.
- [ ] Normal quit and update install each dispose existing services once and
      end through their correct final action.
- [ ] Focused service, IPC, and lifecycle tests pass, plus typecheck/build.

## Out of Scope

- About/notification presentation.
- GitHub Actions release creation.
- Signing credentials, prerelease channels, automatic download, or downgrade.
