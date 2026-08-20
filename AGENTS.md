<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# PiPilot Engineering Rules

This file applies to the entire repository. Current work is tracked in
`.trellis/tasks/`; completed phase documents under `docs/` are historical
evidence and do not constrain future development.

## Product and development

- The product name is `PiPilot`.
- Do not claim a feature, integration, package, signature, notarization, or test
  result that has not been exercised against the current worktree.
- Inspect installed package types and authoritative upstream documentation
  before using version-specific Electron or Pi SDK APIs.

## Dependencies and repository hygiene

- Check for an equivalent already in the project before adding a dependency,
  and record its exact purpose.
- Prefer one maintained dependency per capability and avoid overlapping
  packages.
- Use pnpm and preserve `pnpm-lock.yaml`; CI installs use a frozen lockfile.
- Do not modify third-party package files or `node_modules`.
- Trellis may generate or update regular project files under
  `.agents/skills/trellis-*`. Installing or updating unrelated repository
  Skills requires separate review.
- Local skill symlinks under `.agents/skills/` are machine-specific and must not
  be committed. Do not stage tracked-file deletion noise caused by local
  symlink replacement unless repository removal is a separately reviewed task.
- Keep generated reports and test artifacts ignored.
- Preserve unrelated user changes in a dirty worktree.

## Verification

- Finish related edits before running checks.
- Run the smallest relevant checks first; use broader checks for shared, core,
  or cross-module changes.
- Do not add tests for low-risk copy, style, configuration, dependency version,
  or mechanical refactors unless the task requires them.
- Never delete or weaken a failing test to obtain a passing result.
- Report the commands actually run and their real outcomes.
