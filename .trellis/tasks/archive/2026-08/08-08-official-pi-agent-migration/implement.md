# Implementation Plan

## 1. Build The Local Pi RPC Host

Complete `08-08-official-pi-remote-runtime`:

- add explicit/discovered executable configuration and capability status;
- classify the current Worker/preload/Store surface through the official-first
  audit before defining replacement contracts;
- implement strict LF JSONL, documented contracts, request correlation,
  process-generation lifecycle, diagnostics, and typed preload bridge;
- launch `--mode rpc --approve` with normal environment and no embedded fallback;
- prove global/project extension discovery through fake and real no-model smoke.

## 2. Discover Pi Sessions And Add The Catalog

Complete `08-08-official-pi-session-catalog`:

- derive the effective directory from official `sessionFile`;
- add bounded read-only official session metadata and open delegation;
- keep project/projectless cwd explicit and omit `--session-dir`;
- perform no session or resource data migration/cleanup.

## 3. Cut Renderer Over And Restore RPC Capabilities

Complete `08-08-official-pi-remote-renderer`:

- hydrate and apply official snapshots/events in one generation-scoped provider;
- render documented message/tool/progress/error variants;
- wire every supported action, command catalog, restart refresh, and extension
  dialog/fire-and-forget surface;
- implement idle Prompt, running default Queue, one-shot Steer, separate Stop,
  official queue event/count/mode projection, and extension-source immediate
  command routing while preserving captured submissions until acceptance;
- remove old renderer semantics and only unsupported/policy actions.

## 4. Remove Credential Ownership

Complete `08-08-credential-storage-alternatives` after renderer cutover:

- delete credential CRUD/test/UI/contracts/repository/crypto/Keychain and
  runtime injection;
- delete `credentials.json` ownership from source without a startup cleanup;
- leave official Pi authentication untouched.

## 5. Delete The Remaining Legacy Agent Stack

Complete `08-08-remove-legacy-agent-stack` after the read-only Diff sibling is
ready:

- delete embedded Worker/supervisor/protocol/reducer/policies/repositories;
- delete permission/resource persistence paths without touching old external
  app data;
- remove sensitive path/environment and Diff mutation/fingerprint behavior;
- preserve RPC/catalog correctness and all desktop features;
- remove old build input and direct Pi dependencies with pnpm.

## 6. Run The Final Cutover Gate

Complete `08-08-verify-official-pi-remote-migration`:

- validate the task tree and structural restore/delete/retain inventory;
- recheck latest/local Pi versions and dependency absence;
- run focused/full/Electron/build/package checks;
- exercise the running Queue/Steer/Stop contract, reconnect count-only state,
  official queue modes, and read-only bounded queue view;
- exercise fake and real no-model local Pi plus packaged explicit path without
  version-manager PATH;
- record actual pass/fail/not-run evidence.

## Sequencing And Ownership

- Runtime is first; state consumes runtime; renderer consumes both.
- Credential cleanup follows renderer to avoid transitional embedded-Worker
  work.
- Legacy cleanup follows renderer/credential and coordinates with the umbrella
  read-only Diff task before deleting mutation code.
- Verification follows all implementation children.
- Any implementation agents must own disjoint task/file sets, preserve unrelated
  dirty-worktree changes, and never stage local skill symlinks.

## Pre-Start Gate

- Every child uses local documented JSONL RPC and contains no PiServer/client or
  SDK-runtime plan.
- Every child declares ownership/dependencies and has curated implementation and
  check context.
- The umbrella PRD includes optional MCP disclosure and Pi-only core acceptance.
- The latest final planning summary receives a subsequent explicit
  implementation approval before `task.py start`.
