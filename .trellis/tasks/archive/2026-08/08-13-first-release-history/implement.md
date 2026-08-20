# Implementation Plan

1. Confirm all dependencies and integrated validation are complete.
2. Fetch/prune and snapshot exact local/remote refs.
3. Generate and review the intended source inventory, AI collaboration
   whitelist, symlink validation, and exclusion scans.
4. Create/inspect one root commit from the reviewed 0.0.1 tree.
5. Point local main to the root and rerun final consistency checks.
6. Request final destructive confirmation with exact refs.
7. Force-with-lease remote main, verify, then push annotated v0.0.1.
8. Observe the public Release workflow and report its exact outcome.

No implementation agent owns this task. The main session executes it serially.

## Local release-candidate evidence

The reviewed `0.0.1` worktree passed the following local gates before the root
commit was constructed:

- focused update/release tests: 2 files, 13 tests;
- full unit suite: 53 files, 370 tests;
- TypeScript typecheck and production Electron/Vite build;
- integration Playwright: 2 tests;
- Electron Playwright: 9 tests;
- `electron-builder --dir` for macOS arm64 with ad-hoc signing and notarization
  explicitly disabled;
- packaged application smoke: 1 test;
- Trellis manifests, locale parity, YAML/JSON parsing, diff whitespace, source
  inventory, symlink, large-file, credential-pattern, and host-path audits.

These results prove only the current local macOS worktree and packaged app.
Windows/Linux native package jobs and the public Release remain owned by the
tag-triggered GitHub Actions workflow and must be reported from its real run.

## Clean-runner reproducibility hardening

- Anchor the generated build-output rule to `/dist/` so official-Pi package
  fixtures under `tests/fixtures/**/dist/` remain tracked source.
- Run `build/verify-test-fixtures.cjs` before both unit-test scripts and fail for
  untracked, ignored, or deleted fixture files.
- Compare the sandbox bridge's window mode with the authoritative
  `BrowserWindow` state instead of assuming every display can host PiPilot's
  default window without maximizing it.
- Derive persistence-test bounds from the actual work area and effective
  minimum size. Snapshot maximized windows with `getNormalBounds()`, matching
  production behavior.
- Read the persisted state after closing the first app instance so the
  synchronous close/flush contract is exercised even when native resize calls
  are no-ops. On restart, require the saved mode plus the exact bounds produced
  by the same display-aware normalization used by production.
- Wait for the MCP save-and-restart completion status and ready runtime before
  issuing the dependent Integrations restart; the config file write precedes
  runtime replacement and cannot be used as its completion signal.
- Declare a public Linux DEB maintainer, remove generated macOS updater metadata
  before manual-download manifest creation, normalize ASAR paths on Windows,
  and use a native `.cmd` fake-Pi launcher for Windows packaged smoke.
- Preserve authoritative queue text across same-session count-only snapshots,
  and do not launch a full hydration after a queue-mode command; otherwise the
  open queue surface can disappear on a clean CI runner even after both queued
  messages were received and rendered.
- Configure the Ubuntu unpacked-app smoke's Chromium SUID helper as
  `root:root`/`4755` and verify it before launch. Keep renderer sandboxing
  enabled and leave the already-built AppImage/DEB candidates unchanged.
- Validate architecture identity through native filename aliases: Linux emits
  `x86_64` AppImage and `amd64` DEB names for canonical `x64`; final assembly
  must accept those exact names without weakening hashes or inventory checks.
- Validate the complete updater metadata inventory: Windows has one NSIS entry;
  Linux has AppImage and DEB entries, while legacy fields identify the primary
  AppImage. Check every entry's manifest membership, size, and SHA-512.

No failed candidate produced native package artifacts or a GitHub Release. The
public `v0.0.1` Release remains gated on the final clean workflow run.
