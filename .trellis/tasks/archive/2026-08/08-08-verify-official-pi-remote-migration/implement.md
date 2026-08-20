# Verification Plan

## 1. Validate Planning And Final Structure

- Validate every runtime-cutover parent/child task and curated context manifest.
- Inspect git status and preserve unrelated edits plus `.agents/skills/`
  symlink/deletion noise.
- Recheck registry/local Pi versions, frozen lockfile, dependency graph, built
  inputs, and the structural delete/retain queries from the design.
- Confirm production and scripts contain no standalone web/mock runtime and map
  every retained Settings value/control to its Main/AppSettings/RPC/MCP owner.

## 2. Run Focused Tests

Expected focused command after implementation:

```bash
pnpm test:unit -- tests/unit/local-pi-jsonl.test.ts tests/unit/local-pi-runtime-host.test.ts tests/unit/official-pi-session-catalog.test.ts tests/unit/conversation-scope.test.ts tests/unit/local-pi-rpc-renderer.test.ts tests/unit/local-pi-extension-ui.test.ts tests/unit/ipc-contracts.test.ts
```

Use the deterministic fake executable and fresh current-schema fixtures. Do not
add old-data migration/cleanup fixtures or treat deleted policy tests as
replacements for retained contracts.
Cover idle Prompt, running default Queue, one-shot Steer, separate Stop,
`queue_update` projection, reconnect count-only state, official mode refresh,
extension-source immediate routing, and absence of queue item mutation.

## 3. Run Real No-Model Local Pi Smoke

- Use the selected explicit executable and disposable Agent/workspace fixture.
- Verify global/project plugin discovery, commands, supported extension UI,
  official error/TUI-degraded behavior, controlled restart, and refreshed state.
- Repeat core handshake with no optional plugins and issue no paid model prompt.

## 4. Run Core Repository Checks

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm test:visual
pnpm build
```

Confirm `test:visual` launches Electron through preload/Main rather than a Vite
web server. Inspect running Queue/Steer/Stop, bounded queue popover, reconnect
count-only state, model-picker, and Settings visual diffs before any baseline
update. Report commands that are not available or not applicable rather than
claiming them.

## 5. Run Packaged Explicit-Path Verification

```bash
pnpm package:dir
pnpm test:packaged -- --grep "local Pi RPC"
```

Prove packaged launch works with explicit Pi configuration and no inherited
version-manager PATH, then verify restart/replacement and clean child shutdown.

## 6. Recover Proportionally And Report

- Return failures to the owning implementation child and rerun the focused
  failing command first.
- Repeat broad gates only when their inputs changed.
- Produce a final matrix of registry/local versions, structural findings,
  commands/results, platform/package facts, skips, blockers, and remaining
  upstream RPC limits.

## Pre-Start Gate

Every implementation child, including cross-parent terminal/MCP Settings and the
final cleanup handoff, must be complete. Production must have no fallback toggle,
selected local Pi must satisfy the final latest verified requirement, and all
contexts/manifests must validate.
