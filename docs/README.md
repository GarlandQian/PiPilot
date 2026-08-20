# PiPilot Documentation

This index is the documentation authority boundary for the `0.0.1` worktree.
Current authority documents are generated from source, manifest, workflow, and
executed evidence. Dated phase reports preserve what was true when that phase
ran and must not be used as current product or architecture claims.

## Current Authority

| Document | Scope |
| --- | --- |
| [README](../README.md) / [简体中文 README](../README.zh-CN.md) | User-facing product, setup, External Control, and release caveats |
| [PRODUCT](../PRODUCT.md) | Product purpose, ownership, constraints, and design commitments |
| [Architecture](ARCHITECTURE.md) | Current Electron/Main/Host/Runtime/catalog/bridge topology and privacy boundary |
| [Packaging](PACKAGING.md) | Manifest-derived targets, package boundary, updater/signing policy, and packaged entry |
| [Test Matrix](TEST_MATRIX.md) | Executable test layers, current checkpoint evidence, and native limits |
| `.trellis/spec/` | Current developer contracts injected before implementation |

## Historical Snapshots

The following preserve dated implementation evidence and are intentionally not
rewritten to match later architecture or test counts:

- [Implementation Plan](IMPLEMENTATION_PLAN.md)
- [Completion Audit](COMPLETION_AUDIT.md)
- [Phase 0](PHASE_0_REPORT.md), [Phase 1](PHASE_1_REPORT.md),
  [Phase 2](PHASE_2_REPORT.md), [Phase 3](PHASE_3_REPORT.md),
  [Phase 4](PHASE_4_REPORT.md), [Phase 5](PHASE_5_REPORT.md),
  [Phase 6](PHASE_6_REPORT.md), [Phase 7](PHASE_7_REPORT.md),
  [Phase 8](PHASE_8_REPORT.md), [Phase 9](PHASE_9_REPORT.md),
  [Phase 10](PHASE_10_REPORT.md), [Phase 11](PHASE_11_REPORT.md),
  [Phase 12](PHASE_12_REPORT.md), and [Phase 13](PHASE_13_REPORT.md) reports

Every historical file carries the same prominent snapshot notice linking back
to this index and the current Architecture, Packaging, and Test Matrix.

## Evidence And Workflow

The active Trellis task and its research under `.trellis/tasks/` are planning
and evidence artifacts, not public product authority. Generated `release/`,
`test-results/`, package-manager metadata, fixtures, third-party docs,
workspace journals, and machine-local Skills are excluded from this index.

When a claim changes, update the owning current authority and run the relevant
source/type/test/package check. Preserve old dates, versions, commands, and
findings in historical snapshots rather than rewriting history.
