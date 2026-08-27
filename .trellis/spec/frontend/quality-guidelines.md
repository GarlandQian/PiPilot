# Frontend Quality Guidelines

## Review Focus

- State has one clear owner and subscriptions are cleaned up.
- Async results cannot overwrite a newer active workspace/session state.
- Lists use stable domain identities.
- New callback and payload shapes reuse the owner type instead of drifting.
- Current localized surfaces keep their locale catalogs in sync.
- Intentional UI changes are reviewed against the task requirement; no retired
  visual freeze or baseline approval gate applies.

## Tests

Match verification to the change:

- Pure reducer/store behavior: focused Vitest file under `tests/unit/`.
- Renderer-to-desktop workflow: relevant Electron Playwright scenario.
- Intentional visual change: inspect the launched Electron screen directly.
- External Control Settings: focused Electron scenario at 1100x680 in both
  locales/themes; assert the internal tab strip itself has no overflow and wait
  for animations before screenshots.
- Low-risk copy, styling, config, or mechanical edits normally use existing
  checks and do not require a new test.

Useful commands:

```bash
pnpm typecheck
pnpm test:unit -- tests/unit/local-pi-rpc-renderer.test.ts
pnpm test:electron
pnpm build
```

Run only the smallest applicable set first. See `package.json` for the current
script definitions.

## Existing Test Examples

- `tests/unit/local-pi-rpc-renderer.test.ts`: pure state transitions and stale events.
- `tests/unit/settings.test.ts`: repository, adapter, and store interaction.
- `tests/electron/pipilot.electron.spec.ts`: desktop integration.

## Avoid

- Weakening an existing assertion to make an unrelated change pass.
- Treating a browser-only mock as proof of an Electron flow.
- Treating a checked Switch DOM state captured mid-animation as a valid visual
  baseline.
- Mixing unrelated refactors into a focused feature task.
- Mass-formatting generated UI primitives while changing one feature.
