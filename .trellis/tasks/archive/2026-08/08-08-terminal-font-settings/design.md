# Technical Design

## Settings Contract

Add:

```ts
interface TerminalSettings {
  fontFamily: string
  fontSize: number
}

interface AppSettings {
  locale: Locale
  appearance: AppearanceSettings
  terminal: TerminalSettings
}
```

`fontFamily` is bounded to 120 characters; `fontSize` uses the established
terminal/code range unless xterm inspection requires a narrower supported
range. `AppSettingsPatch` supports a partial terminal patch. The repository's
existing queued atomic write remains the only persistence path.

The new shape is the only supported settings contract. Its validation rules are:

- valid current terminal values are preserved;
- missing/invalid terminal fields make the persisted current document invalid;
  the repository follows its whole-document corrupt recovery path and writes
  fresh current defaults rather than partially migrating typography;
- another document version is not parsed or upgraded;
- reset terminal changes only the terminal object; global reset still resets all
  settings through existing semantics.

## Font Stack Resolution

Create `resolveTerminalFontStack(value)` separate from code typography:

1. sanitized selected/custom family, when present;
2. recommended developer monospace families already used by PiPilot;
3. explicit CJK-capable families in cross-platform preference order;
4. generic `monospace`.

Quote a custom single family safely and strip embedded quotes using the existing
font helper pattern. Do not accept raw CSS fragments and do not probe/download
fonts. The preview and xterm receive the exact same resolved string.

## Settings UI

Replace the Terminal placeholder with a `TerminalSettings` component following
existing `SettingSection`/`SettingRow` controls:

- Select: recommended, curated known terminal fonts, custom;
- conditional custom family input;
- numeric slider/stepper for terminal size;
- stable preview line with `PiPilot 123 () []` plus localized Chinese sample;
- reset-to-terminal-default command.

Controls write through the existing settings store and show the effective stack
via preview styling. Appearance continues to own UI/code typography.

## Xterm Update Flow

`RealTerminalPanel` reads `settings.terminal`. Terminal construction uses
resolved family/size. A layout effect updates `terminal.options.fontFamily` and
`fontSize`, applies matching container font features, then schedules one
`FitAddon.proposeDimensions`/resize pass.

The effect does not change its process/session creation dependencies. Therefore
typography changes keep the same Main terminal ID and input/output subscription.
Workspace change or explicit restart remains the only reason to create a new
PTY generation.

## Verification

- Settings unit cases: complete current document, rejection/recovery of missing
  or malformed terminal fields, partial update, reset, atomic persisted output,
  and explicit rejection of other document versions.
- Resolver cases: default, curated, quote-containing custom, missing font
  fallback order, CJK families present.
- Component/xterm fixture: same terminal identity/output before and after live
  family/size change; one bounded refit and valid dimensions.
- Electron visual: default/custom/missing-family preview and Chinese terminal
  output at supported viewport sizes.

## Rollback

Rollback is a code revert before release. There is no settings migration or
downgrade path to preserve.
