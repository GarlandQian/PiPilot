# Remove PiPilot Credential Ownership

## Goal

Delete PiPilot's credential storage and management after local-Pi renderer
cutover so the selected official Pi executable is the only component that reads
its authentication configuration.

## Confirmed Decisions

- Official local Pi owns provider authentication, `auth.json`, environment
  credentials, refresh behavior, and provider errors.
- PiPilot must not read, write, parse, decrypt, migrate, test, or display stored
  credential values.
- Electron `safeStorage`, macOS Keychain integration, the encrypted PiPilot
  repository, runtime credential injection, credential CRUD/test APIs, and
  credential Settings UI are all removed.
- Delete every product path that creates, reads, writes, or references PiPilot's
  `credentials.json`. Because this is an unreleased direct cutover, do not add a
  startup scanner, deletion helper, importer, or compatibility path for old
  external app data.
- No Keychain replacement, plaintext store, master password, or third-party
  secret manager is added.
- This child adds no dependency and does not modify third-party packages.

## Requirements

- Land after renderer production traffic uses the selected local Pi process, so
  no transitional change is made to prolong the embedded Worker.
- Remove credential values/records from Worker startup payloads, shared schemas,
  Main IPC, preload APIs, renderer state, web fixtures, settings routes, model
  overrides, diagnostics, and active product text.
- Delete the Main credential repository, cryptography helpers,
  `safeStorage`/Keychain initialization, credential-specific tests, and unused
  locale strings.
- Keep official model selection and official runtime errors. PiPilot may tell an
  unauthenticated user to configure the selected local Pi, but it must not infer
  credential state by reading Pi files or add provider-specific auth UI.
- Never inspect, mutate, migrate, or delete Pi's `auth.json` or old external
  PiPilot credential data.

## Acceptance Criteria

- [ ] Local Pi starts with its normal inherited environment/Agent directory and
      PiPilot sends no credential collection, provider secret, or auth path
      override in any RPC/startup contract.
- [ ] No production import/reference remains for Electron `safeStorage`, the
      PiPilot credential repository/cryptography, credential schemas, or
      credential IPC/preload methods.
- [ ] Credential list/set/delete/test controls, routes, stores, mocks, shortcuts,
      and locale copy are absent.
- [ ] Official model lists and provider errors still render without a PiPilot
      credential record or custom backend/security metadata.
- [ ] No startup cleanup/import branch exists for previous PiPilot app data, and
      official `auth.json` is outside PiPilot's filesystem behavior.
- [ ] Focused contract tests, typecheck, and build pass.

## Out Of Scope

- Editing or migrating official `auth.json`.
- OAuth/device-code/API-key UI, connection tests, credential metadata, or
  provider-specific login/logout commands in PiPilot.
- Reading, deleting, recovering, or importing old external PiPilot credential
  files.
- Changing the local Pi executable/transport or model picker beyond removing
  custom credential assumptions.

## Dependencies And Ownership

This child follows renderer cutover. It owns credential repository/crypto files,
credential-specific Main/preload/shared/renderer surfaces, related
tests/locales/docs, and dependency removal made unused only by credentials. The
runtime host remains responsible only for launching local Pi with the normal
environment.

## Risks And Deferred Items

- Any development-only PiPilot credential file is outside the new product model
  and is neither recognized nor modified. Authentication is configured through
  official Pi only.
