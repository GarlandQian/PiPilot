# Documentation current-state audit

## Purpose and boundary

Checked: 2026-08-21.

The owner clarified that this task must leave all project-owned current
documentation consistent with the final product, not merely update the MCP
task notes. This audit classifies documentation before implementation so that
current authorities are rewritten from evidence while historical records are
not falsified.

Included in the current-document claim:

- root public/product documents;
- maintained documents under `docs/`;
- current backend/frontend Trellis specifications and reusable guides affected
  by this task.

Excluded from the claim and not bulk rewritten:

- `node_modules`, packaged app contents, generated build/test output, and
  third-party documentation;
- `tests/fixtures/**` Markdown used as test data;
- `.agents`, `.claude`, `.pi`, and other generated/platform Trellis templates
  unless the Trellis system itself is the task;
- `.trellis/workspace/**` journals and archived task evidence;
- active task research, which remains dated planning evidence rather than
  current product documentation.

## Authority classes and final action

| Authority | Files | Current finding | Final action |
| --- | --- | --- | --- |
| Public entry | `README.md`, `README.zh-CN.md` | Mostly reflects embedded Pi 0.84.2 and v0.0.1, but will become stale after dependency/MCP changes and must describe the final verified release/update path. | Rewrite in semantic lockstep; source versions from the final manifest and platform claims from executed gates. |
| Product contract | `PRODUCT.md` | Still says the Runtime is the user's own local official Pi installation and focuses on outbound MCP only. | Update embedded-SDK ownership, concurrent Sessions, inbound External Control, current UX/security boundaries, and evidence references. |
| Current architecture | `docs/ARCHITECTURE.md` | Contains Pi 0.84.0, former Agent Utility Process/single-active-runtime ownership, phase-target narrative, and pre-public-release/update claims. | Replace with a concise current process, data, lifecycle, security, MCP, and packaging architecture derived from final source. |
| Packaging authority | `docs/PACKAGING.md` | Closer to v0.0.1 release policy but has no inbound headless MCP entry/UDS package contract and must follow final signing/update evidence. | Update exact package contents, targets, headless entry, manual/update policy, client command resolution, and verified native results. |
| Test authority | `docs/TEST_MATRIX.md` | Retains Phase 13 file counts, old Agent Worker naming/paths, and early packaged evidence. | Regenerate from current scripts, tests, CI/release jobs, and actual same-worktree results; distinguish static, local, and native evidence. |
| Documentation index | `docs/README.md` | Missing. Readers cannot tell current authorities from phase snapshots. | Create an authority index with current/historical status and navigation. |
| Engineering authority | `.trellis/spec/backend/**`, `.trellis/spec/frontend/**`, affected `.trellis/spec/guides/**` | Newer than legacy docs, but exact Plan/Goal versions and future MCP/operation ownership will change. | Update only affected executable contracts after implementation; remove superseded ownership and version claims. |
| Historical plan/audit | `docs/IMPLEMENTATION_PLAN.md`, `docs/COMPLETION_AUDIT.md` | The plan says Historical, but the audit title/verdict appears current and conflicts with v0.0.1/public-release state. | Preserve contents; add one standard historical-snapshot notice with current-doc links. |
| Historical phase evidence | `docs/PHASE_0_REPORT.md` through `docs/PHASE_13_REPORT.md` | Correctly records old dates/versions, but headings do not explicitly warn that the content is not current architecture or release status. | Preserve all evidence; add the same prominent historical notice and current-doc links. |
| Governance/workflow | `AGENTS.md`, `.trellis/workflow.md`, platform Trellis files | Managed workflow documentation, not product/runtime documentation. | Change only if implementation alters workflow policy; otherwise leave untouched. |
| Tasks/journals | `.trellis/tasks/**`, `.trellis/workspace/**` | Dated planning, implementation, and collaboration evidence. Two older tasks remain active and the current task is planning. | Do not rewrite as current docs; archive/finish through Trellis lifecycle separately when their work is complete. |

## Confirmed drift examples

- `README.md` and `README.zh-CN.md` say embedded Pi `0.84.2`; the task will
  re-resolve latest before implementation, so hardcoded final versions cannot
  be written until the dependency lane settles.
- `PRODUCT.md` describes the Runtime as the user's local Pi installation even
  though package users no longer need a separate Pi executable.
- `docs/ARCHITECTURE.md` repeatedly names Pi `0.84.0`, an Agent Utility Process,
  one supervised active Runtime, and unavailable publishing/auto-update. Those
  statements conflict with the current embedded SDK/project Host pool and the
  public v0.0.1 workflow.
- `docs/TEST_MATRIX.md` reports the Phase 13 `23 files / 139 tests` run and old
  packaged contents as if they were current evidence.
- `docs/COMPLETION_AUDIT.md` says PiPilot is not a public release and lists
  `0.1.0` artifacts. It is a dated 2026-08-08 audit and must not be used as
  current release authority.
- Historical phase reports legitimately mention Pi `0.84.0`, deferred MCP,
  frozen UI, and old test counts. Those hits remain correct only after the
  documents are visibly classified as historical snapshots.

## Synchronization rules

1. Final source/configuration owns architecture and commands.
2. Final `package.json`/lockfile owns versions; docs do not guess registry
   results from planning evidence.
3. Executed gates own test and platform claims. A configured workflow is not a
   passed workflow.
4. README English/Chinese capabilities, commands, paths, platform tables, and
   caveats remain semantically paired.
5. Current docs never reference generated `test-results`, release output,
   developer home paths, credentials, or machine-specific Skill links as
   required runtime inputs.
6. Historical evidence keeps its original facts. A status banner and current
   links solve ambiguity; version/count replacement would destroy evidence.
7. The documentation pass happens after implementation stabilizes and before
   final release review, on the same worktree as the claimed tests.

## Verification inventory

The final check must include:

- link/path existence and Markdown/diff checks;
- current-doc searches for obsolete Pi versions, Agent Worker/single-Runtime
  ownership, old test counts, pre-public-release status, external Pi executable
  requirements, invalid MCP paths, TCP/`open -a`/Keychain claims, and future
  features written in present tense;
- bilingual README semantic review;
- source-to-doc review for process ownership, MCP tool schemas, operation
  states, package scripts, CI/release jobs, and platform support;
- a separate allowance list for clearly labeled historical snapshots so a
  truthful old version does not get mechanically rewritten.
