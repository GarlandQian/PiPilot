# Implementation Plan

1. Consume the Runtime child package/feed contract and parent `0.0.1`
   first-release identity.
2. Add dedicated Windows/Linux update build config and release-candidate scripts.
3. Keep CI and release verification aligned with the actual current scripts.
4. Add preflight and a release-owned full verification job.
5. Add native matrix jobs.
6. Add deterministic platform manifests/checksums and duplicate-safe assembly
   validation, including updater package size/SHA-512.
7. Add one-shot public Release creation with all validated assets and least privilege.
8. Update packaging/release operator documentation.
9. Run dry workflow, native package/smoke, and authorized public release.

Validation includes YAML/schema inspection, local build/package where possible,
native GitHub Actions evidence, release asset inventory, and public visibility.
