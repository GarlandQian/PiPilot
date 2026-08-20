# Release and Update Evidence

Date: 2026-08-13

## Local Repository Evidence

- `package.json`: Electron 43, electron-builder 26.15.7, pre-change version
  0.1.0, native
  package scripts, no electron-updater dependency.
- `electron-builder.yml`: macOS DMG/ZIP arm64+x64 with `identity: '-'`, Windows
  NSIS x64, Linux AppImage+DEB x64, ASAR, node-pty unpacking, fuse hook.
- `electron-builder.release.yml`: Developer ID/notarization configuration that
  requires external Apple credentials and is not usable for this MVP.
- The previous package-validation workflow supplied a manual native matrix and
  packaged smoke checks. The unified release workflow now owns both dry-run
  validation and public publication, so the duplicate workflow is removed.
- `.github/workflows/ci.yml`: current verification workflow using typecheck,
  unit, build, integration, and Electron E2E. The release workflow owns an
  equivalent independent gate so tag publication does not race a parallel CI
  run.
- `docs/PACKAGING.md`: current artifacts are local validation only; no signing,
  publication, or auto-update success is claimed.
- `src/main/index.ts`: one bounded before-quit cleanup path owns Pi runtimes,
  pool runtimes, integration helper, terminal disposal, and final app quit.
- `src/components/settings/SettingsLayout.tsx`: About is an existing compact
  settings surface and is the approved home for update controls.
- `src/shared/ipc/contracts.ts`, `src/shared/pipilot-api.ts`, and
  `src/preload/index.ts`: strict cross-runtime contract pattern to extend.
- Git history inspection on 2026-08-13: `main` and `origin/main` point to
  `be1a88f`; the other/root commit is `1f7b162`; there are no tags or additional
  local branches; the worktree contains extensive reviewed and unreviewed
  modified/untracked content and must not be destructively reset.

## Upstream Constraints Used by the Plan

- electron-builder GitHub publish provider generates the update metadata used
  by electron-updater and supports public stable Releases.
- Supported updater targets include Windows NSIS and Linux AppImage. macOS
  update installation requires a code-signed application; certificate-free
  ad-hoc signing is not Developer ID trust and does not satisfy that public
  release path.
- electron-updater must be configured with `autoDownload = false` for the
  approved manual-download interaction.
- `latest.yml` is the Windows metadata file and `latest-linux.yml` is the Linux
  metadata file. The MVP intentionally withholds `latest-mac.yml`.
- Public GitHub Releases permit credential-free clients. Private GitHub update
  feeds require client credentials and are not approved for PiPilot users.
- `gh release create <tag> <assets...>` uploads through an internal private
  draft and publishes only after the full asset upload succeeds, preventing a
  partially populated public Release.

## Authoritative References for Implementation Recheck

- https://www.electron.build/auto-update.html
- https://www.electron.build/publish.html
- https://www.electron.build/code-signing.html
- https://www.electronjs.org/docs/latest/tutorial/code-signing
- https://developer.apple.com/developer-id/
- https://docs.github.com/actions/security-for-github-actions/security-guides/automatic-token-authentication
- https://docs.github.com/repositories/releasing-projects-on-github/managing-releases-in-a-repository

Implementation must re-open the current official pages and installed package
types before using version-specific APIs. Search summaries are not sufficient.

## Decision Matrix

| Platform/package | Trust state | Automatic check | In-app download/install | Release action |
| --- | --- | --- | --- | --- |
| macOS DMG/ZIP | ad-hoc, no Developer ID/notarization | yes | no | open public GitHub Release |
| Windows NSIS | unsigned | yes | no for `0.0.1`; native remains proof-gated | open public GitHub Release and download manually |
| Linux AppImage | checksum, no commercial signing | yes | yes after native fixture proof | manual Download, then confirmed Restart/install |
| Linux DEB | checksum | yes | no | open public GitHub Release |

## AI Development Source Audit

The source and package boundaries are intentionally different.

Portable first-release source approved for GitHub:

- `AGENTS.md`;
- regular project-owned `.agents/skills/trellis-*` and
  `.agents/skills/pipilot-ui-style`;
- project-scoped `.claude`, `.codex`, and `.pi` agents/hooks/prompts/settings
  after non-secret/path checks;
- `.trellis` workflow, agents, scripts, specs, tasks, configuration, and generic
  workspace documentation;
- the current `.mcp.json`, which parsed as one Playwright stdio server with no
  credential field or absolute path.

Current portable configuration inspection:

- `.pi/settings.json` contains only skill-command enablement plus relative
  extension/prompt references; no credential field or absolute path was found.
- `.claude/settings.json` contains project hooks, one non-secret environment
  behavior flag, and no enabled plugin secret; hook commands are relative.
- `.codex/config.toml` contains project instructions, bounded agent depth, and a
  Playwright stdio MCP definition; `.codex/environments/environment.toml`
  contains project setup/action metadata.
- `.claude/skills/pipilot-ui-style` is a repository-relative link to the
  project-owned regular Skill directory and is portable if its target is in the
  root tree.

Personal/runtime source rejected from GitHub:

- `.trellis/.developer`, `.runtime`, current-task/session/agent logs, temporary
  state, caches, and backups already covered by `.trellis/.gitignore`;
- `.trellis/workspace/GarlandQian/` journal/session history;
- ten current `.agents/skills/*` absolute links into the local machine's
  external Skill installation directory;
- tracked-deletion noise from older locally replaced external Skills;
- real user credentials, sessions, auth, Pi/MCP/model data, and environment
  secrets.

Host-path scan found absolute local paths in three archived Trellis documents.
Those retained documents must be sanitized or excluded before the root commit,
then the entire intended source inventory must be scanned again.

Packaging remains allowlist-based: current `electron-builder.yml` includes
compiled `out/**`, `package.json`, and required production dependencies, not
the project AI directories. Packaged inspection must assert that `.agents`,
`.claude`, `.codex`, `.pi`, `.trellis`, `AGENTS.md`, `.mcp.json`, credentials,
logs, and absolute host paths are absent.

## First-Release and Rollback Notes

- Version `0.0.1` is installed manually because no earlier updater-enabled
  release exists.
- The workflow creates a public Release only after source/Electron verification,
  artifact inventory, hashes, native smoke evidence, metadata, and warnings
  have all passed their gates.
- The broken initial public `v0.0.1` was explicitly authorized for deletion and
  replacement before the first-release line was accepted. After that one reset,
  a bad published version is corrected with a higher SemVer release; replacing
  files under an existing published version remains forbidden.
