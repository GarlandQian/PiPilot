# Credential Ownership Research

## Official Local Pi Boundary

The selected local Pi executable owns authentication configuration and provider
behavior before RPC starts. The documented JSONL protocol exposes models and
official errors but no general credential list/set/delete/test API. Reading or
editing Pi auth files from PiPilot would therefore create a separate credential
system beside the chosen official-runtime boundary.

PiPilot instead preserves the launch environment and Agent-directory variables,
then consumes only documented RPC results. It does not need to know whether Pi
authenticated through `auth.json`, environment variables, OAuth, or a provider
extension.

## Current PiPilot Behavior To Remove

The current worktree contains an encrypted `<userData>/credentials.json`,
Electron `safeStorage`/Keychain cryptography, Main repository/IPC, Worker startup
injection, credential shared types, renderer settings/state, mocks, and tests.
These form parallel credential ownership and are removed after local-RPC
renderer cutover.

## Confirmed Fresh-State Decision

The user explicitly rejected Keychain and requested removal of
`credentials.json`. Because no released compatibility contract exists, removal
means deleting the product's path constant, repository, schemas, APIs, UI, and
runtime injection. PiPilot does not add startup logic to find, import, or delete
old external app data, and official Pi files are never opened or modified.

## Rejected Alternatives

- Keychain/`safeStorage` or another encrypted PiPilot store: duplicate ownership.
- PiPilot plaintext/master-password/secret-manager persistence: non-official
  configuration and extra required setup.
- Direct `auth.json` editor or provider login bridge: unsupported parallel API.
- Transitional embedded-Worker auth adaptation: prolongs code removed by the
  migration and adds no final product value.

## Verification Anchors

- Search production code for `safeStorage`, credential repositories/types,
  credential IPC/preload methods, and credential-bearing runtime payloads.
- Exercise official model/error rendering through local RPC with no PiPilot
  credential payload or repository initialization.
- Confirm no `credentials.json` path, old-data cleanup hook, or migration branch
  remains in active product code.
