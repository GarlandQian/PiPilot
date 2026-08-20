# Technical Design

## Ownership Boundary

```text
official Pi CLI/configuration
  -> local Pi process reads auth/settings/environment
  -> official RPC models, responses, and provider errors
  -> PiPilot presentation
```

There is no reverse credential flow. PiPilot neither locates nor monitors
`auth.json`; it launches the selected executable with the normal environment and
uses only documented RPC output.

## Cutover Sequence

This child runs after the renderer no longer consumes the legacy Worker. That
avoids implementing a temporary official-auth adapter inside code that will be
deleted. Remove contracts from the outermost product surface through Main and
then delete repositories/crypto once TypeScript exposes all stale callers.

## Fresh-State Boundary

`credentials.json` is removed as a product concept: no path constant,
repository, schema, startup hook, cleanup helper, or active documentation remains.
The application does not inspect or mutate old external app data. Official Pi's
`auth.json` and environment-based authentication stay entirely outside PiPilot.

## Contract And UI Removal

Remove credential request/response discriminators and value-bearing fields from
shared schemas first, then Main handlers, preload exposure, renderer adapters,
stores, Settings components, mocks, tests, and locales. Remove model overrides
whose source was PiPilot credentials while preserving models returned by
official `get_available_models` and official command errors.

Any setup guidance is generic: configure authentication with the selected local
Pi. PiPilot does not inspect whether an API key, OAuth token, or environment
variable exists and does not claim a particular storage mechanism.

## Failure Behavior

- Missing/invalid official auth is an official Pi error or model availability
  outcome.
- No fallback to Keychain, PiPilot files, injected environment values, or
  embedded runtime exists.

## Test Design

- Structural/contract checks for credential value fields, IPC channels,
  `safeStorage`, repository, and crypto imports.
- Local RPC fixture proves models/errors still flow with no PiPilot credential
  payload.
- Broader tests are updated only where removed UI/contracts were previously
  asserted; tests solely for deleted repository behavior are removed.

## Rollback

Rollback is a code revert before release. There is no on-disk migration or
destructive data operation to reverse.
