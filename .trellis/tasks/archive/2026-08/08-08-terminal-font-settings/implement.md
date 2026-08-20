# Implementation Plan

## 1. Extend Persisted Settings

- Add terminal types/defaults/patching to the single current document schema.
- Remove prior-version parsing assumptions; do not copy values from appearance
  or add a compatibility adapter.
- Update settings IPC/store adapters and existing persistence tests.

## 2. Add Terminal Font Resolution And Settings UI

- Add the recommended plus CJK terminal stack and custom-family resolver.
- Replace the Terminal placeholder with selector, custom input, size control,
  preview, and terminal-only reset using existing settings primitives.
- Add Chinese and English localization for labels, preview, and errors.

## 3. Apply Settings To Xterm Live

- Construct xterm from `settings.terminal`.
- Update family/size and schedule one fit on live changes without changing PTY
  creation/subscription dependencies.
- Keep hidden input/container typography and data attributes synchronized for
  Electron assertions.

## 4. Verify

After all related edits:

```bash
pnpm test:unit -- tests/unit/settings.test.ts tests/unit/terminal-font-settings.test.ts
pnpm typecheck
pnpm test:electron -- --grep "terminal font"
pnpm build
```

Inspect default/custom/missing-family and Chinese-output screenshots. Record the
actual installed fallback used on the verification system; do not claim every OS
font was exercised.

## File Ownership And Pre-Start Gate

This child owns shared current settings fields for terminal typography, settings
store/adapter changes required by that contract, Terminal Settings, font helpers,
RealTerminalPanel font/refit behavior, locales, and focused tests.
Coordinate shared settings edits with the local Pi executable-setting work and
MCP Settings child. Context manifests must validate before start.
