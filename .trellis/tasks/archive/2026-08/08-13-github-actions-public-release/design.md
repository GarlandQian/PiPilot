# Design

The first canonical version is `0.0.1`; preflight accepts `v0.0.1` only for
the initial release and rejects any mismatch with `package.json`.

## Jobs

1. Preflight computes canonical version/tag and verifies public/unpublished
   repository state.
2. A release-owned verification job runs typecheck, unit, build, integration,
   and Electron E2E.
3. Native macOS, Windows, and Linux jobs package and smoke independently.
4. Assembly downloads all Actions artifacts, rejects duplicate basenames,
   validates updater package references/sizes/SHA-512 and a declared inventory,
   and creates one public Release with the complete asset set.

Native jobs use `contents: read`; assembly alone uses `contents: write`.
Release assembly should use the preinstalled authenticated `gh` CLI rather than
adding a release-action dependency.

## Artifact Contract

Each native job outputs packages plus a JSON platform manifest and SHA-256 file.
The manifest records version, platform, arch, trust state, update capability,
and relative asset filenames without host paths. Assembly compares manifests to
the Runtime child contract and rejects extras/missing/mismatched versions,
duplicate basenames, or updater metadata that does not match the referenced
package size and SHA-512.

## Version Immutability

The workflow owns a fixed asset allowlist. Any existing Release for the version
causes preflight to fail. Published assets are never rebuilt or overwritten.

## Publication

The workflow calls `gh release create` with all validated assets. GitHub CLI
uses an internal private upload draft and publishes only after every asset has
uploaded successfully.
