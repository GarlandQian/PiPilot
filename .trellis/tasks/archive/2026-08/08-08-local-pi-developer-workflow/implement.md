# Implementation Plan

## 1. Recheck External Contracts

- Recheck latest Pi, Material Icon Theme, Pierre Diffs, MCP adapter, and
  jsonc-parser versions from official sources.
- Probe the selected local Pi and inspect installed public RPC/package types.
- Reconcile every current Agent/preload/Store operation against
  `research/official-first-audit.md`; an Agent-facing operation without a current
  official contract is removed rather than reimplemented.
- Record exact dependency purposes and confirm no equivalent existing package.
- Preserve lockfile, third-party files, unrelated worktree changes, and local
  skill symlinks.

## 2. Build The Core Local Pi Path

Execute nested runtime-cutover children in dependency order:

1. local executable discovery and strict JSONL runtime host;
2. Pi-owned session discovery and bounded read-only current-format catalog;
3. renderer snapshot/event/action/extension UI cutover.

At this point all production conversations use the selected local Pi, all
documented retained actions work, and no optional plugin is required.
The renderer cutover includes the running Composer contract: idle `prompt`,
default `follow_up` Queue, one-shot `steer`, separate `abort`, official
queue events/count/modes, and extension-source command routing.

## 3. Complete Independent UI Slices

- Move the sidebar toggle into the stable ChatHeader leading slot.
- Add Material file/folder icons and canonical Pi brand asset verification.
- Add the current terminal settings schema, custom/CJK stack, and live xterm
  refit.
- Replace Diff with lazy read-only `@pierre/diffs` and remove mutation APIs.

These can use separate agents/files, except shared settings and
WorkspaceContentService changes must land sequentially.

## 4. Complete RPC-Dependent Workflows

- Add official session cost/context after renderer stats stabilize.
- Add Composer images/context after image command contracts and read-only
  WorkspaceContentService land.
- Add optional MCP disclosure/config after commands/status/restart and final
  Settings layout stabilize.

Prove all three work with no optional plugin where applicable; MCP alone shows
the confirmed absent-adapter explanation.

## 5. Remove Credentials And The Legacy Stack

- Delete credential CRUD/UI/crypto/Keychain/injection and every source reference
  to PiPilot `credentials.json` after renderer cutover, with no startup cleanup.
- Complete embedded-stack cleanup after read-only Diff: remove
  Worker/protocol/reducer/policies/resources, permission/resource persistence,
  sensitive path/env and mutation fingerprints, old build input, active claims,
  and direct Pi SDK dependencies.
- Remove the standalone web runtime and all production fixture branches: web
  scripts/visual server, `src/data/mock` imports, Store/adapter modes, static
  Inspector/chat/workspace/resources, and Settings localStorage authority.
- Converge Settings to the real-source matrix after runtime/renderer/terminal/MCP
  owners land; remove disabled General/Updates/Permissions/Agent placeholders,
  hard-coded Pi runtime/About data, and stale locales/tests.
- Recheck that all official RPC-supported actions and desktop features remain.
- Run the official-first structural sweep and require a documented desktop-only
  reason for every surviving custom Agent-adjacent module.

## 6. Run Cutover And Umbrella Gates

First complete the cutover verification child: contexts, versions,
dependencies, structural inventory, focused/full tests, real/fake Pi, Electron,
build/package, and explicit-path packaged startup.

Then run final umbrella integration using current scripts:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm test:visual
pnpm build
pnpm package:dir
pnpm test:packaged
```

Run `test:visual` through Electron, never a standalone Vite server. Inspect
screenshots and build chunks for Settings truth states, model-picker bounds,
sidebar toggles, cost/context, running Queue/Steer/Stop and queue popover,
Material icons, Pi brand, terminal CJK/custom font, read-only Diff, Composer,
extension UI, and MCP absent/present states. Record real results and report
unavailable/skipped checks honestly.

## Agent Ownership

After final implementation approval, dispatch through Trellis with curated
child contexts:

- Codex owns core runtime-cutover children and integration cleanup/verification.
- Claude Code owns sidebar/icons/terminal/read-only Diff.
- Pi owns cost/Composer/MCP after their core dependencies are complete.

Agents are not concurrent on shared settings, SettingsLayout, ChatHeader,
WorkspaceContentService, shared IPC, package manifest, or lockfile without an
explicit handoff. They must not revert user/other-agent edits or stage
`.agents/skills/` symlink/deletion noise.

## Pre-Start Gate

- Every PRD has no blocking open question and passed convergence review.
- Complex children have design and implementation documents.
- Every `implement.jsonl` and `check.jsonl` contains real spec/research context.
- Task-tree/context validation succeeds.
- This final planning summary receives a subsequent explicit user approval
  before any `task.py start`, product edit, dependency install, or agent dispatch.
