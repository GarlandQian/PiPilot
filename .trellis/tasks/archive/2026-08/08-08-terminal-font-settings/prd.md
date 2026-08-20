# Complete Terminal Font Settings

## Goal

Give the real xterm terminal its own persisted custom font family and size,
including practical Chinese/CJK fallbacks, without recreating the PTY or losing
terminal output when typography changes.

## Confirmed Facts

- `RealTerminalPanel` already updates xterm font options and refits live from
  general code typography at `src/components/inspector/RealTerminalPanel.tsx`.
- Settings has a visible Terminal navigation item, but it is currently a
  placeholder in `src/components/settings/SettingsLayout.tsx`.
- The current default mono stack ends at Latin-oriented fonts plus generic
  `monospace`; it does not explicitly include common CJK families.
- Global code and terminal typography currently share
  `appearance.monoFontFamily` and `appearance.codeFontSize`.

## Requirements

- Replace the Terminal Settings placeholder with a dedicated font-family
  selector, custom local family-name input, font-size control, and live preview
  containing Latin, symbols, and Chinese text.
- Add a persisted top-level `terminal` settings object with `fontFamily` and
  `fontSize`. An empty family selects PiPilot's recommended terminal stack; a
  custom value is a local font family name, not a bundled/downloaded font.
- Replace the current settings contract directly with a top-level `terminal`
  object. Use current defaults on a fresh document and add no prior-version
  parser, typography copy, or compatibility migration.
- Resolve the terminal stack as selected/custom monospace family followed by
  maintained cross-platform mono families and explicit CJK fallbacks such as
  Sarasa Mono SC, Noto Sans Mono CJK SC, PingFang SC, Microsoft YaHei, and
  WenQuanYi Micro Hei Mono before generic `monospace`.
- Apply family and size to the existing xterm instance, hidden input, and
  terminal container, then refit rows/columns in the next animation frame.
  Never recreate/close the Main PTY solely for a settings change.
- Preserve existing theme, input, selection, resize, scrollback, word-wrap,
  ligature, lifecycle, and terminal API behavior.
- Missing custom fonts fall through naturally to the recommended/CJK stack; the
  preview must show the effective CSS family so users can evaluate the result.
- Add no font package or remote font download.

## Acceptance Criteria

- [ ] Terminal Settings is a functional page, not a placeholder, and accepts a
      curated family, system/recommended stack, or custom local family name.
- [ ] New/reset settings use bounded defaults and persist atomically across app
      restart.
- [ ] Changing terminal family or size updates the mounted xterm and preview,
      refits once, preserves terminal ID/replay/output/input, and does not create
      another PTY session.
- [ ] The effective default/custom stack contains explicit CJK fallbacks and
      Chinese sample text renders without missing-glyph boxes on a supported
      system with at least one listed fallback installed.
- [ ] A nonexistent custom family falls back without blank terminal content,
      layout overlap, or an exception.
- [ ] Terminal rows/columns remain valid after settings, panel resize, tab
      remount, theme change, and word-wrap modes.
- [ ] Focused current-settings and terminal option tests, typecheck, build, and
      Electron typography screenshots pass.

## Out Of Scope

- Bundling/downloading fonts, enumerating every installed system font, or
  guaranteeing glyphs when the operating system has no compatible fallback.
- Terminal color themes, shell selection, cursor configuration, scrollback
  settings, or unrelated PTY behavior.
- Importing or interpreting any earlier settings document version.

## Dependencies And Ownership

This task is independent of local Pi RPC. It owns the current settings
schema/default for `terminal`, the Terminal Settings page, terminal font
resolution, xterm live application/refit, locales, and focused persistence/UI
checks. It is complex because it changes persisted settings, so `design.md` and
`implement.md` are required.
