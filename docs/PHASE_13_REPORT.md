# Phase 13 Report - Release Security and Stability Review

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 13. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name and verdict

Phase 13 - audit the complete desktop and packaged system, fix every identified
Blocker/High issue, document Medium/Low residual risk, and state release
readiness only from executed evidence.

The reviewed worktree has no known open Blocker or High code finding after the
fixes and verification recorded below. It is a local macOS release candidate,
but it is **not approved for public distribution**: Developer ID signing and
Apple notarization were not executed, and Windows/Linux native package smoke
has not run.

## 2. Review scope

- Electron BrowserWindow preferences, application protocol, CSP, navigation,
  external links, session permissions, preload exposure, and IPC sender binding.
- Public IPC schemas, response validation, event identity, privilege ownership,
  error handling, and Renderer data exposure.
- Workspace canonicalization, traversal and symlink handling, Git subprocesses,
  file bounds, binary handling, conflicts, and write/revert behavior.
- Agent shell approval risk, persisted-rule matching, scope, expiry, abort,
  cleanup, and session/workspace binding.
- Credential persistence, safeStorage behavior, subprocess environments,
  logs, diagnostics, tool output, resource metadata, and package contents.
- Agent Utility Process crashes, generations, stale events, resource reloads,
  extension trust, and isolated failure behavior.
- Model/provider metadata, output/context bounds, UI state truth, accessibility,
  localization, frozen visuals, dependencies, native packages, and release
  configuration.

### Modified file groups

| File/group | Purpose |
| --- | --- |
| `src/shared/build-info.ts`, `external-url.ts`, and shared schemas | One source of truth for build metadata, actionable URLs, and bounded public data |
| `src/main/ipc/`, `src/main/windows/`, and `src/main/security/` | Exact window/frame ownership, startup-safe binding, session permission checks, and sanitized child environments |
| `src/main/workspace/workspace-content-service.ts` | Canonical filesystem enforcement plus Git metadata/config rejection and filter-free exact staging |
| `src/main/permissions/` and `src/agent-worker/permission-gate.ts` | Risk/scope correction, complete operation fingerprints, and redacted tool/approval output |
| `src/agent-worker/resource-catalog.ts` and resource settings/store paths | Sensitive metadata minimization and explicit default-off extension trust |
| Renderer settings, Markdown, session/file/terminal controls, shared UI primitives, and i18n catalogs | Truthful state, shared URL policy, accessible semantics, and bilingual confirmations/fallbacks |
| `src/styles/globals.css` | Restrict Tailwind discovery to production UI sources so docs/tests cannot alter generated CSS |
| unit, Electron, packaged, and visual tests | Stable regressions for every changed security boundary and final end-to-end evidence |
| architecture, test, packaging, implementation, and phase reports | Exact decisions, commands, results, residuals, and release hold |

## 3. Blocker and High findings

No Blocker was found. Every High finding below was fixed in this phase and
reverified against the current worktree.

| ID | Finding | Resolution and evidence | Status |
| --- | --- | --- | --- |
| H-01 | A trusted application URL alone was not a sufficiently exact IPC identity, and binding the stricter validator only after navigation created a startup race. | Every invoke now requires the current Main-owned BrowserWindow, its exact WebContents, its main frame, and a trusted frame URL. Main binds the newly created window before navigation. Foreign/null-window unit cases and restart E2E pass. | Fixed |
| H-02 | Raw errors, tool details, resource metadata, or future detail fields could disclose secrets or absolute host paths. | Main unexpected-handler logs contain only fixed channel identifiers. Tool details use a safe allowlist. Permission presentations and resource text redact credentials, tokens, private keys, credential URLs, environment secrets, and POSIX/Windows absolute paths. Regression fixtures include deliberately sensitive values. | Fixed |
| H-03 | Agent Worker and PTY child processes inherited the full parent environment, allowing ambient credentials and Electron/Node execution controls to cross privilege boundaries. | A shared child-environment builder removes secret-shaped variables, credential-bearing URLs, `NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_RUN_AS_NODE`, all `PIPILOT_*` variables, and null values. Agent and terminal processes use it; unit and real faux-shell assertions pass. | Fixed |
| H-04 | Discovered extensions were executable code and could be loaded by default without an explicit trust decision. | Every extension, including ordinary and MCP-related extensions, now defaults disabled unless Main has a saved explicit preference. Enabling requires a destructive-style confirmation warning. Skills/prompts remain data resources. Transactional reload, rollback, persistence, and default-off E2E pass. | Fixed |
| H-05 | Persistent permission rules could be broader than the approved operation: write/edit matching omitted the argument fingerprint, and opaque shell/network operations could receive long-lived scopes. | The version-2 matcher includes the complete argument fingerprint. Read is low risk, write is medium, and shell/network/destructive/custom operations are high risk and session-only. Old version-1 file-operation hashes fail closed. Same-path/different-content and interpreter/network regressions pass. | Fixed |
| H-06 | Main-owned Git commands could inherit repository hooks, fsmonitor, user/system configuration, credential helpers, sensitive parent environment, or repository-local clean filters that execute arbitrary programs. Git metadata could also redirect writes outside the workspace. | Git runs without a shell and with a sanitized environment; hooks, fsmonitor, prompts, pagers, and global/system configuration are disabled. Git directories/config/objects/index/alternates are checked inside the workspace, and executable/include/external-path local configuration fails closed. Accept uses a bounded 20 MiB handle read and writes the reviewed raw blob/index entry through plumbing instead of `git add`, so clean filters cannot run. File mode is part of the conflict fingerprint. Unit and real accept/revert E2E pass. | Fixed |
| H-07 | Renderer Markdown and Main external-opening policy did not share one exact URL validator, leaving room for scheme/credential/relative-link disagreement and ambient remote image requests. | Both boundaries now share one bounded absolute HTTP(S) validator that rejects credentials, missing hosts, relative/hash links, and unsupported schemes. Unsafe links are non-clickable. Raw HTML is skipped, and remote Markdown images degrade to localized text because production CSP intentionally has no remote image channel. Unit and Electron navigation tests pass. | Fixed |

## 4. Additional security and correctness improvements

- Clipboard permission checks are bound to the current Main-owned WebContents,
  the exact trusted origin, and only `clipboard-sanitized-write`; all other
  session permission requests remain denied.
- Application metadata now comes from Main and reports real application,
  Electron, architecture, runtime, and mode values instead of Renderer literals.
- The About issue link targets the actual PiPilot repository. Updates remain
  disabled and truthfully unavailable instead of reporting simulated success.
- Inert General settings are visibly disabled and described as not configurable.
  Permission and Terminal placeholders now describe those sections rather than
  reusing unrelated provider copy.
- Session-list semantics no longer use `listbox/option` for rows containing
  rename/menu controls, and no interactive element is nested inside another.
  Theme selectors expose button/pressed semantics; inputs have names,
  autocomplete behavior, labels, and spellcheck intent where applicable.
- Recent projects now expose localized, non-nested pin/unpin controls and a
  project-specific accessible open label. Large session sets use bounded
  50-row pagination that follows the active session. Bounded transcript
  truncation is disclosed through a localized status row.
- Generic `transition-all` declarations were replaced by explicit transition
  properties. FileTree no longer claims an incomplete ARIA tree contract.
- The shared Button primitive defaults real buttons to `type="button"`, avoiding
  accidental form submission while preserving `asChild` behavior.
- Remote Markdown images are intentionally text-only. This keeps the Renderer
  aligned with the production CSP and avoids an unreviewed tracking/network
  channel.
- Tailwind source discovery is explicitly limited to `src/` and `index.html`.
  Adding Phase 13 Markdown had previously changed generated CSS from 97.05 kB
  to 98.77 kB; the bounded source set now produces 96.59 kB and remains
  pixel-identical.

## 5. Process and trust-boundary result

- Renderer remains sandboxed and has no Node.js, filesystem, child-process,
  credential-read, path, Pi SDK, raw IPC, or generic invoke/send capability.
- Preload remains a frozen, typed, business-level facade. Main validates every
  request and response and authorizes the exact current window/frame.
- Main owns BrowserWindow lifecycle, credentials, persistence, permission
  decisions, workspace files, Git, PTYs, navigation, and external links.
- Agent Utility Process owns Pi runtime objects, sessions, tools, resources,
  and normalized events. Worker failure remains contained from the main window.
- Secrets needed by a configured provider move only from Main's encrypted
  repository to Worker memory. Ambient API-key environment authentication is no
  longer forwarded to Worker; users must use encrypted credential settings or a
  provider mechanism that does not depend on secret parent environment values.
- Manual Terminal is an explicit user-operated trust boundary. Its live output
  can naturally show paths or user-entered secrets, but PiPilot does not persist
  or copy that output into production diagnostics.

## 6. UI changes and frozen-UI compliance

The visible changes were limited to functional truth, confirmation, and
accessibility semantics required by the audit:

- extension code warning and enable confirmation;
- truthful disabled/unavailable settings text;
- real About/build information;
- localized inaccessible-image fallback text;
- recent-project pin/unpin, session pagination, and truncated-history status;
- ARIA and form semantics without geometry or styling changes.

Every new visible string exists in both `zh-CN` and `en-US`. The approved
three-column layout, theme tokens, colors, typography, 14/16/12/13 px scales,
spacing, radii, borders, density, Markdown presentation, ToolCallCard, and
ApprovalCard visuals were preserved. Comparison-only visual testing passed
10/10 with zero baseline updates.

## 7. Dependencies and upstream review

Phase 13 added or updated no dependency. `pnpm audit --prod` reported no known
vulnerabilities after an initial sandbox DNS failure was retried with approved
network access.

The lockfile resolves Electron 43.3.0. The official schedule reviewed on
2026-08-08 lists the Electron 43 line as supported through 2027-01-05. This is
a support-window statement, not a claim that 43.3.0 is the newest release.

Authoritative sources:

- <https://www.electronjs.org/docs/latest/tutorial/security>
- <https://www.electronjs.org/docs/latest/tutorial/fuses>
- <https://releases.electronjs.org/schedule>
- <https://www.electron.build/docs/configuration/>
- <https://www.electron.build/docs/tutorials/adding-electron-fuses/>
- <https://tailwindcss.com/docs/detecting-classes-in-source-files>

## 8. Verification evidence

### Type, unit, build, and security checks

- `pnpm run typecheck`: passed after the final source changes.
- Focused Vitest security run: 10 files and 74 tests passed.
- `pnpm run test:unit`: 23 files and 139 tests passed.
- `pnpm run build`: passed; final package rebuild also repeated typecheck and
  the complete production electron-vite build.
- `pnpm audit --prod`: `No known vulnerabilities found`.

### Integration and Electron

- The final exact `pnpm run test:integration` gate passed 6/6 in 17.8 seconds.
- The final complete `pnpm run test:electron` gate passed 9/9 in 29.4 seconds,
  including appearance/zoom/keyboard accessibility, configured and rejected
  model selection, both required memory extensions, recent-project pin/open,
  resource configuration, projected tools, and workspace/session lifecycle.
- The affected workspace scenario separately passed 1/1 after replacing an
  obsolete locator and waiting for the switched runtime's real `ready` state.
- `pnpm run test:visual`: 10/10 passed in 10.3 seconds in comparison-only mode.
  No baseline was regenerated or modified.

### Package and native evidence

- `pnpm run package:mac`: completed for arm64 and x64 DMG/ZIP targets.
- `pnpm run test:packaged`: 1/1 passed in 7.2 seconds against the final arm64
  packaged application.
- Both application bundles passed `codesign --verify --deep --strict`. These are
  explicitly ad-hoc local signatures with no distribution identity.
- `electron-fuses read --app` reported all nine expected Electron 43 fuse values
  on both architectures.
- `file` reported matching Mach-O arm64/x86_64 architecture for each application
  executable and unpacked `node-pty` binary.
- Both ASAR files were scanned for the local workspace and home prefixes; neither
  prefix was present.

Final ignored local validation artifacts:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `PiPilot-0.1.0-arm64.dmg` | 121,856,780 | `02e496bbed98734518e3f2b2c58c4d93d57186dabee2b2d369934c673ed5a041` |
| `PiPilot-0.1.0-arm64.zip` | 118,029,304 | `e20f10a37879fd22296abd36671aae8cbdb6e96de9dc4877ec14bedb8a82f51f` |
| `PiPilot-0.1.0-x64.dmg` | 126,977,402 | `4e852fec4c9192d39ddc92e7dccc6b04c17d32b46838a1d1e63f89b3a9ad8df1` |
| `PiPilot-0.1.0-x64.zip` | 123,153,955 | `84d33bf0c7da18c8eeff56199e60b7719b271db2adee18d40bd55183a6738b8c` |

Expected packaging warnings remained: node-gyp warns about the space in the
repository path even though both `node-pty` rebuilds complete, and
electron-builder lists non-host optional clipboard binaries. Native artifacts
and the host smoke were independently verified.

## 9. Remaining Medium findings

| ID | Residual risk | Recommendation |
| --- | --- | --- |
| M-01 | Canonical path checks and mutation are separate operations, so a hostile local process with write access can attempt a symlink-swap TOCTOU between them. Final-component no-follow behavior, workspace revalidation, fingerprints, and stale-write checks reduce but do not eliminate this OS-level race. | Move sensitive mutations to an audited file-descriptor/openat-style helper or native boundary that walks and mutates relative to held directory handles. Keep the current checks until that design is available. |
| M-02 | Production CSP still requires `style-src 'unsafe-inline'` because frozen UI behavior uses dynamic style attributes for panel sizes, fonts, progress, tree indentation, and terminal rendering. Script policy remains self-only with no unsafe eval. | Gradually replace application-owned dynamic inline styles with bounded classes/custom-property plumbing that can support a stricter style policy, then separately validate third-party terminal requirements. |
| M-03 | An explicitly enabled extension remains trusted executable code inside the Agent Worker and can act outside PiPilot's tool-approval model. Process isolation prevents a direct Main/Renderer crash but is not an OS sandbox per extension. | Add signed provenance and per-extension capability/sandbox policy before recommending untrusted third-party extensions. Preserve default-off and explicit confirmation. |
| M-04 | GitHub Actions references maintained version tags rather than immutable action commit SHAs. Current workflows are read-only and hold no release credentials. | Pin action SHAs before adding signing, publishing, or other secret-bearing workflow steps, and schedule controlled update review. |
| M-05 | Windows x64 and Linux x64 package/smoke jobs are configured but have not executed in this worktree. macOS x64 was structurally verified but not launched on the arm64 host. | Run the checked-in native matrix and retain its logs/artifact hashes before broad platform distribution. |
| M-06 | Linux safeStorage `basic_text` detection is covered by logic/tests but has not been exercised on a native Linux desktop/keyring environment. | Include secure-backend and fallback assertions in the Linux native package job and release checklist. |

## 10. Remaining Low findings

- Some compact 24-32 px desktop controls are below generic 44 px touch-target
  guidance. They remain keyboard accessible; enlarging them would violate the
  approved compact desktop density and frozen geometry. Revisit only through a
  separately approved UI change.
- Publishing and auto-update are intentionally unavailable. The UI now states
  this truthfully; implement them only after signing, hosting, rollback, and
  recovery have been exercised.
- The initial Renderer bundle is above 2 MiB. This is a performance opportunity,
  not a security or functional release blocker; optimize without disturbing the
  frozen interaction model.

## 11. Release readiness

| Gate | Result |
| --- | --- |
| Current source type/build/unit/security checks | Passed; unit 23 files / 139 tests |
| Full integration boundary gate | Passed 6/6 |
| Complete Electron desktop E2E | Passed 9/9 |
| Frozen visual comparison | Passed 10/10; no baseline update |
| macOS arm64 packaged primary workflow | Passed 1/1 |
| macOS arm64/x64 local artifacts, fuses, native architecture, ad-hoc integrity | Passed |
| Production dependency audit | No known vulnerabilities |
| Known open Blocker/High code findings | None after fixes |
| Developer ID signing and Apple notarization | Not executed |
| Native Windows/Linux build and packaged smoke | Not executed |
| Publishing/update feed/rollback | Disabled and unverified |

Therefore the code is ready for the next controlled release-validation step,
but public distribution is not approved. A public macOS release requires a real
Developer ID build, notarization, ticket/stapling/Gatekeeper verification, and
retained evidence. Windows/Linux distribution additionally requires their
native matrix jobs and platform-appropriate signing decisions.

## 12. Repository hygiene

- Generated `release/`, test results, traces, and block maps remain ignored.
- No visual baseline was updated.
- No file was staged, committed, pushed, published, or released.
- Machine-local `.agents/skills/` symlink/deletion noise was not edited,
  restored, staged, or included in artifacts, per project policy and the
  user's explicit instruction.
- Existing `.playwright-mcp` working-tree noise was also left untouched.
- No Codex/agent Skill, MCP plugin, or Playwright browser was installed.

## 13. Required phase-report field index

This index explicitly satisfies the required 17-field phase-report contract
while preserving the severity-first security review above.

| Required field | Phase 13 evidence |
| --- | --- |
| 1. Phase name | Section 1 |
| 2. Completed work | Sections 2-5 |
| 3. Modified files | Section 2, "Modified file groups" |
| 4. Purpose of each file | Section 2 table |
| 5. Dependencies and reason | Section 7; none added or updated |
| 6. New IPC | No completion-audit IPC; reviewed existing strict IPC in Sections 2 and 5 |
| 7. New shared types | No completion-audit shared type |
| 8. New schemas | No completion-audit runtime schema |
| 9. Tests added or changed | i18n parity, session pagination, and expanded Electron/packaged scenarios in Section 8 |
| 10. Verification commands | Section 8 |
| 11. Real command results | Sections 8 and 11 |
| 12. UI files modified | Sidebar, SessionList, MessageList, App wiring, and locale catalogs |
| 13. UI necessity | Section 6; exposes required project management, bounded-list, and truncation state |
| 14. Visual regression | Sections 6, 8, and 11; 10/10 comparison-only |
| 15. Remaining mock data | Browser/visual fixtures and deterministic faux Provider remain test-only; production paths are real |
| 16. Known issues | Sections 9-11; no open Blocker/High |
| 17. Next plan | Controlled signed/notarized macOS validation plus native Windows/Linux matrix before public distribution |

The final requirement-by-requirement result is recorded in
`docs/COMPLETION_AUDIT.md`.
