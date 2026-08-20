# Implementation Plan

## Delivery Order

### Phase 0 — First-release identity

1. Set the authoritative application/package version to `0.0.1` and update
   version assertions and documentation without editing generated artifacts by
   hand.
2. Confirm local package names and updater fixtures use `0.0.1`.

### Phase 1 — Desktop update runtime (`08-13-desktop-update-runtime`)

1. Re-open current electron-updater/Electron/GitHub official documentation and
   inspect the installed dependency types after adding the exact dependency.
2. Add strict shared update schemas/types and IPC contracts.
3. Implement Main provider adapters and the revision-safe update state service.
4. Register status/check/download/install IPC and preload facade.
5. Refactor Main shutdown into an idempotent normal-quit vs update-install
   coordinator that preserves all existing bounded disposal.
6. Add renderer adapter/provider without presentation styling.
7. Add focused state/service/IPC tests and a packaged-context inspection.
8. Publish the stable packaging/feed contract for the release child.

### Phase 2 — Public release workflow (`08-13-github-actions-public-release`)

Depends on Phase 1's package/feed contract.

1. Add the public GitHub update build configuration for Windows/Linux while
   keeping macOS on the base ad-hoc/manual configuration.
2. Add release-candidate scripts and keep CI/release verification aligned with
   the actual current test scripts.
3. Implement stable tag/version/public-repository preflight.
4. Add the release-owned full source/Electron verification gate.
5. Extend/reuse the native matrix for release-candidate packages and smoke.
6. Generate platform manifests and checksums; reject duplicate basenames and
   validate metadata package references, sizes, hashes, and exact inventory.
7. Implement the least-privilege public assembly job using `GITHUB_TOKEN` and
   `gh`, with safe rerun behavior.
8. Add release notes/trust matrix and operator documentation.
9. Run a workflow dry run and, only when authorized, the real public release.

### Phase 3 — About update experience (`08-13-update-about-ui`)

Depends on Phase 1's renderer contract and may run in parallel with Phase 2
after that contract stabilizes.

1. Consume the update provider in App/Settings without direct preload calls.
2. Add the compact About update section and exact state/action rendering.
3. Add the center update notice and navigation to About.
4. Add active-work install confirmation, inline errors, and trust warnings.
5. Add en-US/zh-CN copy with parity.
6. Verify pointer/keyboard/focus, reduced motion, light/dark, and 1100×680.

### Phase 4 — Integrated release gate

1. Run focused unit and Electron gates after all children integrate.
2. Run full typecheck/unit/build because the task changes shared contracts,
   Main lifecycle, dependencies, and packaging.
3. Run native package/smoke matrix.
4. Prove generated metadata, checksums, update fixture/canary, and Release
   inventory.
5. Review docs and UI for false signing/notarization claims.
6. Keep the parent in review until all children pass and a real GitHub Release
   run has been reported truthfully.

### Phase 5 — New root commit and first tag

1. Re-read Git status, remote branches/tags, and every changed/untracked file.
2. Audit the first-release inventory for ignored output, secrets, user paths,
   local configuration, and machine-specific Skill symlinks/deletion noise.
   Include the approved portable Codex/Claude Code/Pi/Trellis project files;
   exclude developer workspace journals and sanitize absolute paths in retained
   historical Trellis documents.
3. Create one new root commit from the exact reviewed `0.0.1` tree and point
   local `main` to it without discarding files.
4. Present old/new commit IDs and request final destructive confirmation.
5. Force-push `main` only after that confirmation, verify remote state, then
   create and push annotated `v0.0.1`.
6. Observe and report the real public Release workflow result.

## Expected High-Risk Files and Seams

- `package.json`, `pnpm-lock.yaml`
- `electron-builder.yml` plus dedicated update/release config
- `.github/workflows/ci.yml` and the unified public release flow
- `src/main/index.ts` shutdown lifecycle
- new Main update service/adapters and IPC registration
- `src/shared/ipc/contracts.ts`, `src/shared/pipilot-api.ts`, preload
- renderer update provider and `src/App.tsx`
- `src/components/settings/SettingsLayout.tsx`
- both locale catalogs
- packaged/Electron tests and `docs/PACKAGING.md`
- `.gitignore` and the portable/personal AI development source boundary

Avoid concurrent edits to shared contracts, `src/main/index.ts`, `package.json`,
and `src/App.tsx`. Child dependencies are intended to serialize these seams.

## Validation Commands

Start with the exact focused commands introduced by each child. The integrated
gate should include, as applicable:

```bash
pnpm typecheck
pnpm exec vitest run tests/unit/app-update-service.test.ts tests/unit/ipc-contracts.test.ts
pnpm test:unit
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts --grep "application update"
pnpm package:dir
pnpm test:packaged
```

Native release validation is performed on GitHub-hosted macOS, Windows, and
Linux runners. Record exact workflow URLs/results; do not infer remote success
from a local macOS build. A real public Release requires separate user approval
at execution time because it mutates GitHub Releases.

Remote history force-push requires another just-in-time confirmation after the
new root commit exists, because the exact old/new refs can only be verified
then.

## Stop/Review Conditions

- Stop if the repository is private.
- Stop if current official electron-updater behavior contradicts the selected
  unsigned Windows path.
- Stop rather than disabling integrity/signature checks.
- Stop before pushing the release tag unless public publication has been
  explicitly authorized.
- Re-present planning if a signing credential, prerelease channel, store target,
  or automatic-download policy is added.
- Do not rewrite Git history before all code, packaging, and update gates pass.

## Pre-Start Checklist

- [x] Product/platform/update decisions resolved.
- [x] PRD convergence pass complete.
- [x] Parent design and implementation plan written.
- [x] Child artifacts and manifests validated.
- [ ] Final planning summary presented.
- [ ] User explicitly approves that final summary in a later message.
- [ ] Only then run `task.py start` and dispatch implementation.
