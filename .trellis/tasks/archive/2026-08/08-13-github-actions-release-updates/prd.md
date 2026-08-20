# GitHub Actions Packaging, Public Releases, and Application Updates

## Goal

Give PiPilot one repeatable release path that builds native macOS, Windows,
and Linux packages in GitHub Actions, publishes one complete public GitHub
Release after every gate passes, and provides an honest update experience without
claiming credentials or trust that the maintainer does not have.

## User Value

- Maintainers create a release candidate from one SemVer tag instead of
  packaging three platforms by hand.
- Users can see when a newer PiPilot version exists and use the safest update
  path supported by their installed package.
- A failed build, smoke test, artifact check, or updater-metadata check cannot
  change the public update feed.
- The UI states exactly whether PiPilot can download/install the update or must
  open GitHub Releases for a manual download.

## Confirmed Repository Evidence

- `package.json` is version `0.1.0` and uses Electron 43,
  electron-builder 26.15.7, electron-vite 5, pnpm, and a frozen lockfile.
- `electron-builder.yml` currently builds:
  - macOS arm64/x64 DMG and ZIP;
  - Windows x64 NSIS;
  - Linux x64 AppImage and DEB.
- Before this task, a separate package-validation workflow performed manual,
  artifact-only native packaging and packaged smoke tests on macOS 26,
  Windows 2025, and Ubuntu 24.04 runners. The unified release workflow removes
  that duplicate entry point and supersedes its dry-run role.
- `.github/workflows/ci.yml` runs the current typecheck, unit, build,
  integration, and Electron commands. The release workflow repeats these gates
  in its own verification job instead of depending implicitly on another
  workflow run.
- The base macOS build uses certificate-free ad-hoc signing (`identity: '-'`)
  after the Electron fuse hook. It is launchable local packaging, not Apple
  Developer ID signing, notarization, or Gatekeeper trust.
- `electron-builder.release.yml` contains an unused Developer ID/notarization
  path, but no Apple credentials are available for this task.
- No Windows signing configuration or Windows signing credentials exist.
- No `electron-updater` dependency, Main update service, strict update IPC,
  renderer update state, or About update controls exist.
- No publish provider is configured, so installed packages have no production
  update feed and release metadata is not assembled for GitHub Releases.
- The Git remote is `github.com:GarlandQian/PiPilot.git`. The selected product
  policy requires this repository and its Releases to be public. GitHub API
  access was unavailable during planning, so the workflow must verify
  repository visibility before creating a Release.
- `docs/PACKAGING.md` correctly says existing artifacts are local validation
  candidates and must not be represented as signed, notarized, or published.

## Key Decisions

1. **First public version:** PiPilot's first release is `0.0.1`; the first
   stable tag is `v0.0.1`.
2. **Release host:** public GitHub Releases in `GarlandQian/PiPilot`.
3. **Publication policy:** a matching stable tag creates a public Release only
   after release-owned source/Electron verification, every native build,
   packaged smoke, manifest, checksum, and assembly gate passes. No separate
   human Publish step is required.
4. **Update interaction:** automatically check, but never automatically
   download or install. Download and restart/install are explicit actions.
5. **macOS:** retain certificate-free ad-hoc packaging for launchability; label
   it as not Developer ID signed/not notarized. It supports version checking
   and opening GitHub Releases, not in-app download/install.
6. **Windows:** publish unsigned NSIS and enable in-app download/install only if
   a native isolated updater test proves the official updater path works. Show
   an explicit unknown-publisher/SmartScreen warning and never claim verified
   publisher status.
7. **Linux:** AppImage supports in-app download/install; DEB is a manual
   download because package-manager replacement is out of scope.
8. **Channels:** MVP supports stable SemVer only. Prerelease channels are
   deferred.
9. **First-release Git history:** after implementation and all release gates
   pass, the reviewed `0.0.1` source tree becomes one new root commit. Local and
   remote `main` will no longer expose the two pre-release commits. The exact
   remote force-push remains a separate just-in-time destructive confirmation.
10. **AI development files:** commit portable, project-owned collaboration
    configuration for Codex, Claude Code, Pi, and Trellis; exclude personal
    runtime state, journals, credentials, real sessions/configuration, host
    paths, and machine-specific external Skill links. None of these development
    files may enter packaged PiPilot artifacts.

## Requirements

### R1. Release Trigger and Version Contract

- Change the authoritative application/package version from `0.1.0` to
  `0.0.1`. Packages, manifests, updater fixtures, checksums, Release
  title, and version assertions must use `0.0.1`.
- Stable releases use annotated tags matching `vMAJOR.MINOR.PATCH`.
- The tag version must exactly equal `package.json.version`; mismatches stop
  before native packaging.
- `workflow_dispatch` supports a dry run that builds and verifies all targets
  but does not create or modify a GitHub Release.
- Tag-triggered runs use concurrency keyed by the tag and do not cancel an
  in-progress release assembly.
- The preflight gate must reject a private repository, a non-stable SemVer tag,
  a tag/version mismatch, or an already published version.

### R2. Native Artifacts and Platform Policy

- Each target builds on its native GitHub-hosted runner with the repository's
  pinned Node/pnpm versions and `pnpm install --frozen-lockfile`.
- Reuse the current native targets, Electron fuse hook, native dependency
  rebuild, and packaged smoke tests.
- macOS outputs arm64/x64 DMG and ZIP using the existing ad-hoc identity. The
  release notes and About UI say that the package is not Developer ID signed or
  notarized and may require the user's manual Gatekeeper override.
- Windows outputs x64 NSIS and updater metadata without a publisher signature.
  Release notes and UI identify the unknown-publisher/SmartScreen risk.
- Linux outputs x64 AppImage, DEB, and AppImage updater metadata. DEB remains a
  manual-install artifact.
- Each native job emits deterministic artifacts, a bounded platform manifest,
  and SHA-256 checksums. Update blockmaps/metadata required by the enabled
  updater targets are included.
- No `latest-mac.yml` is published for this MVP because macOS in-app
  download/install is unsupported without Developer ID signing.

### R3. Public Release Assembly

- Native jobs upload Actions artifacts only; they never independently publish
  or mutate the public release feed.
- A release-owned verification job must pass typecheck, the full unit suite,
  production build, integration tests, and Electron E2E before native package
  jobs begin. The independent branch CI workflow is not an implicit release
  dependency.
- One assembly job with job-scoped `contents: write` waits for every required
  native job, downloads all outputs, validates exact filenames/version/arch,
  rejects duplicate basenames, checks hashes and updater metadata package
  references/sizes/SHA-512, and creates one public Release together with the
  complete validated asset set.
- The assembly job uses the repository `GITHUB_TOKEN`; no PAT or token is
  embedded into PiPilot.
- A normal rerun fails if any Release already exists for that version; workflow
  assets are never resumed, replaced, or clobbered. One explicitly authorized
  first-release reset is recorded by child task
  `08-14-windows-packaged-runtime-fixes`: the broken initial public `v0.0.1`
  Release and its run were deleted before repair, and the same version may be
  created again only after the native Windows acceptance gate passes.
- The Release contains generated notes plus a fixed platform trust/update matrix,
  installers, update payloads, updater metadata, blockmaps, and checksums.
- `gh release create` receives every validated asset in the creation command;
  GitHub CLI keeps the upload private internally and publishes only after all
  assets upload successfully.

### R4. Main-Owned Update Runtime

- Add `electron-updater` as the native update implementation for Linux AppImage
  and for Windows NSIS only after native proof. Set `autoDownload = false`,
  disable automatic install on quit, stable channel only, and no downgrade.
- macOS, unproven unsigned Windows NSIS, and non-AppImage Linux packages use a
  bounded public GitHub latest release checker in Main and expose a
  manual-release capability.
- Check once after a short application-ready delay, then at a conservative
  fixed interval while running, and whenever the user selects Check again.
- The service owns a strict state machine covering disabled, idle, checking,
  current, available, downloading, downloaded, and error states. Capabilities
  distinguish native install from manual release download.
- Main validates all third-party updater/GitHub values, bounds release text and
  progress data, stores only fixed diagnostic codes, and never sends raw errors
  or credentials across IPC.
- Renderer access uses shared Zod schemas, validated IPC handlers, preload, a
  renderer adapter/provider, and one current snapshot plus subscription.
- Development, unpackaged, unsupported, and test contexts do not contact the
  production feed unless an isolated test adapter is explicitly injected.
- A discovered update never starts a download automatically.
- Restart/install requires an already downloaded native update and explicit
  user confirmation. If Pi runtimes or terminals are active, Main requires a
  second confirmation and then reuses the existing bounded shutdown path
  before invoking the updater install action.

### R5. PiPilot Update Experience

- Add an Application updates section to Settings → About; do not add a new
  top-level navigation destination.
- Preserve PiPilot's current compact settings layout, semantic tokens,
  Tabler/react-icons family, light/dark themes, 1100×680 minimum, reduced
  motion, focus treatment, and English/Chinese locale parity.
- Render honest disabled/loading/current/available/downloading/downloaded/error
  states. Do not show stale version/progress from a previous state.
- Native states provide Check, Download, retry, and Restart and install actions
  as appropriate. For `0.0.1`, Linux AppImage is native; macOS, Windows NSIS,
  and DEB provide Check and Open GitHub Release.
- The unsigned Windows and non-Developer-ID macOS warnings are adjacent to the
  relevant action, not hidden in documentation.
- When automatic checking finds a new version, show one dismissible,
  non-blocking notice inside the center work-surface notification region and
  keep the persistent state in About. Do not use a success modal or place the
  notice in the application's outer top-right corner.
- The active-work confirmation uses the existing AlertDialog interaction
  language; install errors remain inline and recoverable.

### R6. Validation, Operations, and Rollback

- Validate shared contracts/state transitions with focused unit tests and the
  Main/preload/renderer flow with Electron tests using injected fake providers.
- Validate generated `app-update.yml`, `latest.yml`, `latest-linux.yml`,
  blockmaps, checksums, platform manifests, ASAR/native contents, and packaged
  startup.
- Run the native package/smoke matrix before creating the public Release.
- Prove unsigned Windows NSIS and Linux AppImage download/install behavior in
  isolated native update fixtures before enabling each capability. Never turn
  off updater integrity checks to make the test pass. If unsigned Windows is
  rejected by the official implementation, stop and revise the product policy
  to manual download instead of bypassing validation.
- The first public release is a bootstrap manual installation. Before
  publishing later versions, execute the documented previous-version canary or
  equivalent isolated fixture for supported native updater targets.
- Document repository visibility, required GitHub permissions, version/tag
  procedure, release gate checklist, first-release bootstrap, platform
  warnings, bad-release response, and future signing activation.
- After the first-release reset above is complete, never overwrite a published
  version. Recovery from any later bad release uses a higher SemVer version;
  removing a release is not treated as a reliable downgrade mechanism.

### R7. First-Release Git History

- Do not rewrite local or remote history while implementation or validation is
  incomplete.
- After all child tasks and integrated gates pass, audit the exact intended
  first-release file set. Exclude ignored build/test output, credentials,
  developer-specific configuration, absolute user paths, and machine-specific
  Skill symlinks or deletion noise.
- Create one new root commit containing the reviewed PiPilot `0.0.1` tree and
  move local `main` to it without discarding the dirty worktree.
- Immediately before changing `origin/main`, re-read remote branches/tags and
  present the old/new commit IDs. Force-push requires a final explicit
  destructive confirmation.
- Create and push annotated tag `v0.0.1` only after the new root is verified on
  remote `main`; that tag starts the public Release workflow.
- Evidence on 2026-08-13: local/remote `main` currently contain two commits
  (`1f7b162`, `be1a88f`), no tags, and no other local branches. Recheck before
  rewriting because remote state may change.

### R8. AI Development Source and Package Boundary

- Include portable project collaboration source in the first root commit:
  - `AGENTS.md`;
  - regular project-owned `.agents/skills/trellis-*` directories;
  - regular `.agents/skills/pipilot-ui-style` and its approved assets;
  - project-scoped `.claude/` agents, hooks, settings, and repository-relative
    links;
  - project-scoped `.codex/` agents, hooks, config, and environment definition;
  - project-scoped `.pi/` agents, prompts, and non-secret settings;
  - `.trellis` workflow, agents, scripts, specs, tasks, templates/version data,
    generic workspace documentation, and configuration;
  - the current non-secret project `.mcp.json` Playwright configuration.
- Exclude personal or runtime AI data:
  - `.trellis/.developer`, `.current-task`, `.runtime/`, `.ralph-state.json`,
    `.agents/`, `.agent-log`, `.session-id`, `.plan-log`, temporary/backups, and
    Python caches covered by `.trellis/.gitignore`;
  - developer-specific `.trellis/workspace/<developer>/` journals and session
    histories while retaining the generic `.trellis/workspace/index.md`;
  - AI conversation/session logs, caches, credentials, tokens, auth files, real
    user Pi/MCP/model/session data, and `.env` files;
  - absolute-host external Skill symlinks under `.agents/skills` and any
    tracked deletion noise caused by replacing prior regular Skills locally.
- A repository-relative platform link such as
  `.claude/skills/pipilot-ui-style -> ../../.agents/skills/pipilot-ui-style` is
  portable and may be committed after link-target validation.
- Sanitize or remove absolute user/machine paths from source-facing historical
  Trellis documents before the root commit. Current inspection found such paths
  in three archived research/PRD files; re-scan the entire intended inventory.
- Keep electron-builder's package allowlist limited to compiled output,
  `package.json`, and required production dependencies. Add package/ASAR
  assertions that reject `.agents`, `.claude`, `.codex`, `.pi`, `.trellis`,
  `AGENTS.md`, `.mcp.json`, credentials, logs, source tasks, or host paths.

## Acceptance Criteria

- [ ] A manual dry run builds and smoke-tests macOS, Windows, and Linux without
      creating or modifying a Release.
- [ ] The application and every release artifact identify version `0.0.1`; the
      first accepted stable tag is `v0.0.1`.
- [ ] A matching stable tag produces one complete public Release; a private
      repository, mismatched tag/version, failed verification/native job, or
      already published version fails closed.
- [ ] Release assets include exact native packages, enabled updater metadata and
      blockmaps, platform manifests, and verified SHA-256 checksums.
- [ ] macOS packages and UI are labelled ad-hoc/not Developer ID signed/not
      notarized and expose manual GitHub Release download only.
- [ ] Windows packages and UI are labelled unsigned; native fixture evidence
      proves the official NSIS updater path before in-app install is enabled.
- [ ] Linux AppImage can manually download and explicitly install an isolated
      newer build; DEB exposes manual download only.
- [ ] Automatic checks never start a download, and development/unpackaged
      builds never contact the production feed.
- [ ] The update snapshot and every IPC action are schema-validated, bounded,
      subscription-safe, and recover correctly from stale async results.
- [ ] Restart/install cannot interrupt active Pi or terminal work without an
      explicit second confirmation and bounded shutdown.
- [ ] Settings → About and the center notification render localized,
      keyboard-accessible, responsive, truthful states in both themes.
- [ ] The public Release is created only after release-owned verification, all
      native packaged-smoke jobs, and assembly gates pass, so the stable update
      client never observes an incomplete asset set.
- [ ] Release documentation contains an exact operator checklist and no secret
      values or false signing claims.
- [ ] The reviewed source tree can be represented by one new root commit without
      committing ignored artifacts, secrets, local paths, or machine-specific
      Skill noise; remote history is not rewritten without final confirmation.
- [ ] The source root contains the approved portable Codex/Claude Code/Pi/Trellis
      collaboration files and omits personal/runtime AI data and external
      machine-specific Skill symlinks.
- [ ] Packaged ASAR/installers contain none of the AI development directories,
      instructions, MCP config, Trellis tasks, credentials, session data, logs,
      or absolute host paths.

## Out of Scope

- Apple Developer Program enrollment, Developer ID signing, Apple notarization,
  or Mac App Store distribution.
- Purchasing or configuring Windows Authenticode/Azure signing in this MVP.
- Microsoft Store, Snap Store, RPM/Pacman repositories, or custom update
  servers.
- Automatic background download, silent installation, forced restart, or
  automatic downgrade.
- Beta/alpha channels, staged rollout controls, or delta infrastructure beyond
  the metadata/blockmaps generated by electron-builder.
- Linux DEB self-replacement or GPG package repository management.
- Keeping the two existing pre-release commits in the public `main` history
  after the separately confirmed first-release history reset.

## Risks and Deferred Items

- macOS users will encounter Gatekeeper friction until a Developer ID
  membership/certificate and notarization credentials are added in a later
  approved task.
- Unsigned Windows NSIS may trigger SmartScreen. The workflow cannot remove
  that warning without a trusted signing program/certificate.
- Public repository visibility is a hard precondition and must be verified in
  GitHub Actions because local planning could not query the GitHub API.
- Real updater installation is platform-native and expensive to test. A public
  Release must not be created until the selected native canary/fixture gate passes.
- The existing signed macOS config remains an inactive future path; it must not
  be selected automatically when credentials are absent.

## Planning Status

All product, UX, platform, release-host, publication, and risk decisions are
resolved. This task is ready for design/implementation review, but remains in
planning until the user approves the final planning summary in a subsequent
message.
