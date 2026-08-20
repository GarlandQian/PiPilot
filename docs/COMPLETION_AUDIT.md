# PiPilot Final Completion Audit

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This audit preserves the earlier
> acceptance review and test counts. It is not current product or release
> authority. See [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

This document maps the original 38 final acceptance items to current source and
executed evidence. `Passed` means the behavior was exercised against this
worktree; it does not imply public distribution approval.

## Verdict

All 38 product acceptance items pass. No known Blocker or High code finding
remains open. PiPilot is a locally verified macOS release candidate, not a
public release: Developer ID signing, Apple notarization, native Windows/Linux
package smoke, publishing, update feeds, and rollback remain unexecuted.

## Final acceptance matrix

| # | Requirement | Current evidence | Result |
| ---: | --- | --- | --- |
| 1 | Electron application starts | Electron and packaged Playwright launch `pipilot://app/`; title and production metadata are asserted | Passed |
| 2 | Renderer has no Node permission | `create-main-window.ts` enables sandbox/context isolation and disables Node; Electron checks `process`/`require` are absent | Passed |
| 3 | IPC is typed and validated | `src/shared/ipc/contracts.ts`, `validated-handler.ts`, preload facade, strict Zod parsing, exact window/frame sender tests | Passed |
| 4 | Settings persist | Main `SettingsRepository`, migration/corruption unit tests, visible settings changes, and restart assertions | Passed |
| 5 | A workspace can be opened | Native folder picker, canonical Main-private path validation, and two real temporary workspaces in E2E | Passed |
| 6 | Recent projects can be managed | Persisted availability/order/pin state plus visible localized pin, open, and unpin controls across restart | Passed |
| 7 | Pi sessions can be created and restored | Real Pi `SessionManager`, per-workspace JSONL roots, new/open/fork/delete, relaunch restoration | Passed |
| 8 | Sessions can be switched | Active-run confirmation, abort/rebind, generation/epoch isolation, and visible session workflow | Passed |
| 9 | A real prompt can be sent | Composer calls the real Pi session/runtime with a deterministic local faux Provider; no Renderer simulation | Passed |
| 10 | Agent replies stream | Stable normalized deltas, frame-batched store publication, persisted reconciliation, and real streaming E2E | Passed |
| 11 | Markdown works | GFM heading/table/code rendering, raw HTML disabled, shared safe-link policy, width assertion | Passed |
| 12 | Tool states are truthful | Real Read/Edit/Bash events project queued/running/waiting/success/failed/cancelled state, output, patch, and duration | Passed |
| 13 | Shell cannot run before approval | Permission gate and Bash E2E assert no side effect before a bound decision and none after denial | Passed |
| 14 | Approval state has no conflict | Reducer and E2E prove waiting-approval is distinct, visible, session-bound, and not simultaneously running | Passed |
| 15 | File tree is workspace-only | Canonical root checks reject traversal, absolute paths, sensitive paths, and symlink escape; tree loads lazily | Passed |
| 16 | Diff matches real changes | Main produces bounded real Git changes/patches; E2E previews, accepts, and observes actual files/index | Passed |
| 17 | Revert will not overwrite an external edit | Fingerprint/context conflict guards reject stale accept/revert after out-of-band modification | Passed |
| 18 | Terminal works | Real `node-pty` create/input/output/resize/exit workflow and packaged native binding inspection | Passed |
| 19 | Agent Shell and manual Terminal permissions differ | Agent Bash is permission-gated in Worker/Main; manual Terminal is an explicit user-operated PTY API | Passed |
| 20 | Models and Providers are manageable | Real model metadata, credential state, failed unconfigured selection rollback, configured custom selection, high thinking level | Passed |
| 21 | API keys never enter Renderer | Main safeStorage repository exposes configured/masked state only; disk, public result, and restart tests inject secrets | Passed |
| 22 | Model output request is bounded | `model-safety.test.ts` proves the minimum of requested, model, context, and application limits | Passed |
| 23 | Skills, Extensions, and MCP are diagnosable | Real Pi loader inventory, source/status/redacted diagnostics, explicit extension trust, MCP bridge risks, rollback | Passed |
| 24 | Hermes and Observational Memory load through Pi resources | One Electron scenario discovers both disabled, enables both explicitly, verifies both loaded, and forwards both commands through Pi | Passed |
| 25 | Dark and light themes work | Visible controls, persistence, packaged smoke, and five states/settings in both visual themes | Passed |
| 26 | `zh-CN` and `en-US` are complete | 471 keys in each catalog; unit test enforces parity, nonempty values, and placeholder equality; E2E switches both | Passed |
| 27 | Font, size, and density settings work | Electron changes UI/mono fonts to 18 px, comfortable density, reduced motion, restarts, and reasserts DOM/CSS state | Passed |
| 28 | Agent Process crash does not take down the window | E2E kills the real Utility Process, observes contained failure, keeps title/window alive, and restarts to a higher generation | Passed |
| 29 | Child processes are cleaned up | Supervisor crash/restart/quit handling plus PTY workspace-switch and application-exit trap assertions | Passed |
| 30 | Unit tests pass | Final exact run: 23 files, 139 tests | Passed |
| 31 | Integration tests pass | Final exact run: 6/6 full-stack boundary scenarios | Passed |
| 32 | Electron E2E passes | Final exact run: 9/9 complete desktop scenarios | Passed |
| 33 | Visual regression passes | Final comparison-only run: 10/10 at 1440 x 900, zero pixel tolerance | Passed |
| 34 | Packaged application smoke passes | Final arm64 packaged primary workflow: 1/1 | Passed |
| 35 | Blocker and High security issues are fixed | Phase 13 records H-01 through H-07 fixed and reverified; no Blocker was found | Passed |
| 36 | Approved UI was not redesigned | Three-column geometry, tokens, type scales, density, Markdown, ToolCallCard, and ApprovalCard remain frozen | Passed |
| 37 | Baselines were not updated to hide a regression | Normal config is `updateSnapshots: 'none'`; final run compared only; no tracked baseline diff exists | Passed |
| 38 | No completion claim is unverified | Exact final commands, counts, binary inspections, artifact sizes/hashes, caveats, and failed-then-fixed checks are recorded | Passed |

Pi 0.84.0 does not expose a native generic MCP subsystem. Item 23 is satisfied
through installed Pi extension/package bridges and their real loader metadata;
generic MCP transport/auth/tool-health behavior is deliberately not claimed.

## Cross-cutting requirements

| Area | Evidence and result |
| --- | --- |
| Agent state | One normalized state model; reducer/tool/approval tests and dark/light running, waiting, failed visual states; waiting approval never presents as running |
| Structured errors | Strict `code/message/details/recoverable/source/requestId/sessionId` boundary, sanitized production diagnostics, local file/terminal/resource/provider failures, no sensitive stack in Renderer |
| Performance | Frame-batched stream and terminal publication, lazy file tree, 50-row session pagination, bounded transcripts/tool output/diffs, non-Renderer traversal |
| Internationalization | 471-key catalog parity and placeholder test, locale-aware time/relative formatting, all completion-audit strings in both catalogs |
| Accessibility | Localized icon labels, named inputs, visible focus, text/icon state, keyboard ApprovalCard and resize handle, 18 px fonts, 125%/150% zoom, reduced motion |
| Process boundaries | Renderer renders only; preload is a typed business facade; Main owns privileged desktop operations; Utility Process owns Pi runtime objects |

## Final executed gates

| Command/check | Actual result |
| --- | --- |
| `pnpm run build` | Passed; typecheck repeated; Main 46 modules, preload 90, Renderer 740 |
| `pnpm run test:unit` | 23 files / 139 tests passed |
| `pnpm run test:integration` | 6/6 passed in 17.8 seconds |
| `pnpm run test:electron` | 9/9 passed in 29.4 seconds |
| `pnpm run test:visual` | 10/10 passed in 10.3 seconds; comparison-only |
| `pnpm run package:mac` | arm64/x64 DMG and ZIP completed; build/typecheck repeated |
| `pnpm run test:packaged` | 1/1 passed in 7.2 seconds |
| `codesign --verify --deep --strict` | Both `.app` bundles valid; signatures are ad-hoc with no Team ID |
| `electron-fuses read --app` | Both architectures report the configured nine Electron 43 fuses |
| `file` | Main executable and rebuilt `pty.node` match arm64/x86_64 targets |
| ASAR host-path scan | No absolute developer host-path occurrence |
| `pnpm audit --prod` | No known vulnerability for the unchanged final dependency lock |

## Final local artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `PiPilot-0.1.0-arm64.dmg` | 121,856,780 | `02e496bbed98734518e3f2b2c58c4d93d57186dabee2b2d369934c673ed5a041` |
| `PiPilot-0.1.0-arm64.zip` | 118,029,304 | `e20f10a37879fd22296abd36671aae8cbdb6e96de9dc4877ec14bedb8a82f51f` |
| `PiPilot-0.1.0-x64.dmg` | 126,977,402 | `4e852fec4c9192d39ddc92e7dccc6b04c17d32b46838a1d1e63f89b3a9ad8df1` |
| `PiPilot-0.1.0-x64.zip` | 123,153,955 | `84d33bf0c7da18c8eeff56199e60b7719b271db2adee18d40bd55183a6738b8c` |

These are ignored local validation artifacts. They are not signed for public
trust, notarized, uploaded, published, or connected to an update feed.

## Phase-report compliance

- Phase 0 through Phase 11 reports use the required 17 numbered fields.
- Phase 12 preserves its packaging-oriented chronology and includes an exact
  17-field compliance index.
- Phase 13 preserves its severity-first security review and includes an exact
  17-field compliance index.
- `docs/TEST_MATRIX.md` maps executable coverage; this document maps the final
  product acceptance list.

## Residual risk and release hold

The remaining Medium/Low findings are recorded in
`docs/PHASE_13_REPORT.md`: filesystem TOCTOU hardening, inline-style CSP,
trusted enabled extensions, mutable CI action tags, unexecuted native
Windows/Linux jobs, native Linux safeStorage behavior, compact desktop target
sizes, initial bundle size, and unavailable publish/update infrastructure.

None is an open Blocker/High or a failure of the 38 local acceptance items.
They do block a public release claim where applicable. The next controlled step
is a credentialed Developer ID build with notarization/stapling/Gatekeeper
evidence and the native Windows/Linux package matrix.
