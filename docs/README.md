# PiPilot Documentation

This index is the documentation authority boundary for the `0.0.1` worktree.
Current authority documents are generated from source, manifest, workflow, and
executed evidence. Superseded planning snapshots and temporary reports are
kept out of the product documentation tree.

## Current Authority

| Document | Scope |
| --- | --- |
| [README](../README.md) / [简体中文 README](../README.zh-CN.md) | User-facing product, setup, External Control, and release caveats |
| [PRODUCT](../PRODUCT.md) | Product purpose, ownership, constraints, and design commitments |
| [Architecture](ARCHITECTURE.md) | Current Electron/Main/Host/Runtime/catalog/bridge topology and privacy boundary |
| [Packaging](PACKAGING.md) | Manifest-derived targets, package boundary, updater/signing policy, and packaged entry |
| [Test Matrix](TEST_MATRIX.md) | Executable test layers, current checkpoint evidence, and native limits |
| `.trellis/spec/` | Current developer contracts injected before implementation |

## Evidence And Workflow

The active Trellis tasks and their research under `.trellis/tasks/` are planning
and evidence artifacts, not public product authority. Generated `release/`,
`test-results/`, package-manager metadata, fixtures, third-party docs,
workspace journals, archived task history, and machine-local Skills are
excluded from this index.

When a claim changes, update the owning current authority and run the relevant
source/type/test/package check. Preserve old dates, versions, commands, and
findings in historical snapshots rather than rewriting history.
