# Technical Design

## Architecture

The task has four independently verifiable child deliveries with explicit
dependencies:

1. `08-13-desktop-update-runtime` owns shared update types, Main services,
   updater/release-check adapters, IPC/preload, renderer state, and coordinated
   install shutdown.
2. `08-13-github-actions-public-release` depends on the runtime's packaging/feed
   contract and owns electron-builder publish configuration, native workflow,
   public assembly, artifact validation, and release operations documentation.
3. `08-13-update-about-ui` depends on the runtime's public renderer contract
   and owns About/notification presentation, actions, i18n, accessibility, and
   visual validation. It does not parse updater events or GitHub payloads.
4. `08-13-first-release-history` depends on all three children plus the parent
   integrated gate. It is executed serially by the primary session and owns the
   reviewed root commit, lease-protected remote history replacement, initial
   tag, and public Release workflow observation.

The parent task is complete only when all four child acceptance gates pass.

## Version and First-Release Repository Initialization

The first published version is `0.0.1`. Set this identity before implementation
verification so package names, embedded application versions, updater metadata,
fixtures, and release workflow gates all exercise the real first release.

Git history initialization happens last, after the reviewed source tree and all
quality gates are complete:

1. audit tracked, modified, deleted, and untracked files against ignore,
   credential, host-path, and local Skill-link rules;
2. create a temporary orphan branch/index from the exact reviewed tree;
3. create one root commit for PiPilot 0.0.1;
4. point local `main` to that root without destructive checkout/reset of files;
5. re-read remote refs and present exact old/new commit IDs;
6. after final destructive confirmation, force-push `main`;
7. verify remote `main`, then create/push annotated `v0.0.1` and observe the
   public Release workflow.

No child worker rewrites Git history. The primary session owns this serial final
operation. A force-push changes the supported public branch history but cannot
guarantee cryptographic erasure from every prior clone, reflog, or GitHub cache.

## AI Development Source Boundary

The first root uses an explicit source whitelist rather than treating every dot
directory as private:

- portable project collaboration source is committed so Codex, Claude Code,
  Pi, and Trellis have reproducible project instructions;
- personal state is ignored even when it lives under an otherwise committed
  platform directory;
- external absolute-path Skill symlinks remain ignored; repository-relative
  platform links are allowed only when the target exists inside the root tree;
- developer-specific Trellis workspace journals are ignored, while generic
  workflow/spec/task documentation is retained after host-path sanitization.

Before the root commit, generate an inventory grouped as portable source,
ignored runtime/personal state, symlinks, and rejected sensitive/path matches.
Fail if an item is ambiguous rather than adding it automatically.

The package boundary is independent of the Git source boundary. The existing
electron-builder `files` allowlist stays compiled-output-based. Packaged tests
inspect ASAR/resources/installers and fail on AI source directory names,
project MCP/agent configuration, Trellis artifacts, credentials, logs, source
paths, or known absolute host prefixes.

## Runtime Boundaries

```text
GitHub published Release
  ├─ Linux updater metadata ──────────> electron-updater adapter (Main)
  └─ public latest release API ───────> manual release checker (Main)
                                                │
                                      ApplicationUpdateService
                                                │
                         shared Zod snapshot/actions/events
                                                │
                            validated IPC -> preload facade
                                                │
                              renderer adapter/provider
                                   ├─ About section
                                   └─ center update notice
```

Main is the single source of update truth. Third-party classes, Error objects,
URLs that have not passed policy validation, filesystem paths, response
headers, or credentials never cross IPC.

## Update Provider Abstraction

Define a small Main-only adapter interface rather than coupling the service to
electron-updater events:

- `check(): Promise<ProviderUpdateResult>`
- `download(): Promise<void>` for native providers only
- `install(): never | void` for native providers only
- `subscribe(listener): unsubscribe`
- `dispose(): void`

Production adapters:

- `ElectronUpdaterProvider`: Linux AppImage, plus Windows NSIS only after a
  future isolated native proof enables it. Configure stable channel,
  `autoDownload = false`, no automatic install-on-quit, no downgrade, bounded
  logger integration, and event cleanup.
- `GitHubReleaseProvider`: macOS, unsigned Windows NSIS without native proof,
  and non-AppImage Linux packages. It uses a bounded Main request to the public
  latest release endpoint, validates a stable `vX.Y.Z` tag and approved GitHub
  HTTPS URL, compares it with `app.getVersion()`, and exposes manual capability
  only while preserving the installed package identity.
- `DisabledUpdateProvider`: development, unpackaged, unsupported, or malformed
  package context. It never touches the network.

Tests inject a fake adapter. No production environment variable or renderer
flag may redirect the update feed.

## Shared State Contract

Create a strict discriminated snapshot under `src/shared/`. The exact names may
follow repository conventions, but invalid combinations must be unrepresentable:

- `disabled`: reason such as development, unpackaged, unsupported package, or
  missing feed;
- `idle` / `checking` / `current`;
- `available`: current version, available version, capability
  (`native-install` or `manual-release`), validated release URL, and bounded
  release summary/date where present;
- `downloading`: native capability plus bounded progress;
- `downloaded`: native capability and target version;
- `error`: operation (`check`, `download`, or `install`), stable error code,
  capability, and recoverability.

All snapshots include platform/package policy and a monotonically increasing
revision so renderer subscribers can reject stale results. Progress values are
finite and clamped. Release notes are bounded before storage/IPC.

IPC actions:

- status;
- check;
- download;
- install with `confirmActiveWork` default false;
- changed event subscription.

Manual release opening may reuse the existing validated `shell.openExternal`
facade with the snapshot's approved GitHub URL, or remain a focused Main action
if that gives a tighter capability boundary. Feature components call a renderer
adapter/provider, never `window.pipilot` directly.

## Scheduling and Concurrency

- Initialize after `app.ready` and Main composition; do not require the About
  screen to mount.
- Perform an automatic check after a short startup delay and at a conservative
  interval (design default: 12 hours). A manual check coalesces with an active
  check rather than starting a second request.
- Only one check or download runs at a time. Provider events are scoped to the
  current operation/revision and cannot restore an older state.
- Automatic-check failures stay available in About but do not create a global
  blocking dialog. Only `available` creates the center notice.
- A dismissed notice is renderer-session-local for that version; the About
  state remains available, and a newer version creates a new notice.

## Install and Shutdown Coordination

`quitAndInstall()` cannot be called before current Pi/terminal resources are
disposed, and the existing `before-quit` handler cannot finish by calling plain
`app.quit()` after an update install was requested.

Refactor the Main shutdown path into one idempotent coordinator with a final
exit intent:

- normal application quit -> bounded disposal -> `app.quit()`;
- confirmed update install -> bounded disposal -> provider `quitAndInstall()`.

The install IPC checks whether the primary Pi runtime, runtime pool, or terminal
service is active. Without `confirmActiveWork`, return a typed confirmation
required error. After renderer confirmation, freeze further install requests,
dispose subscriptions/processes using the existing deadlines, and invoke the
updater exactly once. A failed pre-install transition returns to downloaded or
recoverable error state without pretending the update installed.

## Packaging and Feed Design

Keep `electron-builder.yml` as local validation/base packaging. Add a dedicated
update-release configuration for Windows/Linux that embeds the public GitHub
provider (`GarlandQian/PiPilot`, stable/latest, public) and generates
`app-update.yml`, `latest.yml`, `latest-linux.yml`, and required blockmaps while
using `--publish never` in native jobs.

The macOS job uses the base ad-hoc configuration. If electron-builder emits
`latest-mac.yml` while producing ZIP targets, candidate preparation deletes it
before manifest generation and upload. The existing Developer-ID release
configuration remains inactive and documented as a future credentialed path;
it is never selected by credential auto-detection.

Native jobs emit Actions artifacts. A final Linux/Ubuntu assembly job:

1. runs only after a release-owned macOS verification job passes typecheck,
   unit, build, integration, and Electron E2E gates;
2. verifies public repository and stable tag/version;
3. downloads all native Actions artifacts and rejects duplicate basenames;
4. validates exact expected inventory, manifests, hashes, metadata package
   references/sizes/SHA-512, and the absence of macOS update metadata;
5. invokes `gh release create` with the exact validated asset set;
6. relies on GitHub CLI's internal private upload draft so incomplete uploads
   are never public;
7. verifies the resulting Release is public, stable, and complete.

Use job-level least privilege: native jobs `contents: read`; assembly
`contents: write`. Recheck and pin supported official action revisions during
implementation. Do not use a third-party release action when the installed
`gh` CLI can create and publish the complete Release directly.

## Public Release and Rollback

Publishing is the final Actions step after the release-owned verification,
every native packaged-smoke job, and assembly gate have passed.
`gh release create <tag> <all-assets>` temporarily keeps uploads private and
exposes the Release only after the full asset upload succeeds.

Any existing Release for the version makes the workflow fail. The only
exception is the user-authorized first-release reset tracked by
`08-14-windows-packaged-runtime-fixes`: the broken public `v0.0.1` Release and
its run were removed before repair, so the workflow may create a new complete
`v0.0.1` after native Windows acceptance. Once that replacement is published,
bad releases are superseded by a higher SemVer hotfix; assets are not
overwritten and downgrade is not implemented.

## UI Design

Use `pipilot-ui-style` and the existing Settings/About composition:

- one compact Application updates `SettingSection`, not a top-level page;
- state text, version, last-check metadata, and only currently valid actions;
- inline trust warning for macOS/Windows;
- bounded progress row for native download;
- inline error/retry; no success modal;
- one dismissible update-available notice in the center work-surface
  notification region, with a View update action that opens About;
- active-work install confirmation through the existing AlertDialog pattern.

Use semantic tokens, current primitives, existing Tabler icons, bilingual
locales, visible focus, reduced motion, and 1100×680/light/dark checks.

## Compatibility and Migration

- No legacy updater state exists, so there is no data migration.
- Existing local pre-release builds without updater support must manually
  install the first updater-enabled `0.0.1` release.
- `appId` and artifact version identity remain unchanged.
- Stable channel only; no beta migration.
- Adding future Apple/Windows credentials is a separate policy change that can
  activate signed providers without changing the renderer contract.

## Failure Matrix

| Failure | Required behavior |
| --- | --- |
| Repository private | preflight fails; no Release/feed changes |
| Tag/version mismatch | fail before native jobs |
| One native job fails | no Release mutation |
| Metadata/hash mismatch | assembly fails before upload |
| Existing published version | fail; never clobber after the one authorized first-release reset |
| Existing Release or stale draft | fail; require explicit cleanup before the authorized first-release reset, otherwise use a higher version |
| Automatic check offline/rate-limited | inline recoverable error; no modal/download |
| Download interrupted | recoverable error/retry; previous app remains runnable |
| Active Pi/terminal on install | typed confirmation required |
| Shutdown timeout | install not claimed; fixed diagnostic code |
| Windows unsigned updater rejected | block enablement; revise to manual policy, no bypass |

## Verification Strategy

- Pure service reducer/adapter tests for every transition, coalescing, stale
  event, bounds, capability, and active-work confirmation.
- Strict IPC/preload contract tests.
- Electron test for automatic-check notification, About states, manual/native
  actions, error recovery, and confirmation UI using fake Main adapters.
- Package inspection for embedded update config, expected metadata/blockmaps,
  ASAR/native helper integrity, and production feed absence on macOS.
- Native package/smoke jobs and isolated Windows/Linux update fixture/canary.
- Release workflow dry run followed by a real public Release run; do not claim
  GitHub publication until it has actually run in the repository.
