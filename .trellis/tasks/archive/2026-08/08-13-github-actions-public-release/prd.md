# GitHub Actions Public Release Workflow

## Goal

Build and verify PiPilot on native GitHub-hosted runners, assemble exact release
assets, and publish one complete public Release only after all gates pass.

## Dependencies

- Depends on `08-13-desktop-update-runtime` publishing a stable package/feed
  contract and embedded updater configuration requirements.
- Does not depend on `08-13-update-about-ui`.

## Requirements

- The initial application version is exactly `0.0.1`; the initial stable tag is
  `v0.0.1` and every package/manifest/Release title must match it.
- Stable annotated `vMAJOR.MINOR.PATCH` tag must match `package.json.version`.
- A manual dry run builds/smokes without a Release mutation.
- A release-owned full verification job passes before native packaging begins.
- Preflight verifies the repository is public, the version is unpublished, and
  the tag is stable SemVer.
- Native jobs retain read-only permissions and produce exact packages,
  metadata/blockmaps, platform manifests, and SHA-256 checksums.
- macOS uses current ad-hoc/manual packaging and never emits macOS update feed
  metadata; Windows/Linux use the Runtime-defined update configuration.
- One least-privilege assembly job rejects duplicate basenames, validates all
  inputs including updater package size/SHA-512, and creates one public Release
  with generated trust/update notes and all validated assets.
- A rerun fails when any Release already exists for the version.
- `gh release create` publishes only after its internal private asset upload
  completes successfully.
- Documentation covers bootstrap, tag procedure, release gates, platform
  warnings, bad release response, and future signing activation.
- Packaged validation rejects all project AI development source/configuration,
  including `.agents`, `.claude`, `.codex`, `.pi`, `.trellis`, `AGENTS.md`, and
  `.mcp.json`, even though approved portable files are committed to GitHub.

## Acceptance Criteria

- [ ] Dry run succeeds without GitHub Release mutation.
- [ ] Every package, manifest, checksum inventory, updater metadata file,
      release title, and tag identifies version `0.0.1`.
- [ ] Failed source/Electron verification or missing native output prevents
      Release creation.
- [ ] Exact inventory, hashes, versions, architectures, and updater metadata are
      validated before upload.
- [ ] Native jobs cannot write repository contents; only assembly has
      job-scoped `contents: write`.
- [ ] The Release includes all approved packages and no `latest-mac.yml`.
- [ ] ASAR/installers contain none of the source-repository AI collaboration or
      personal/runtime data paths.
- [ ] The workflow verifies the Release is public and not a prerelease.
- [ ] A real workflow run is reported with its actual URL/result before this
      child is marked complete.

## Out of Scope

- Signing credentials, prerelease channels, custom host, or store distribution.
