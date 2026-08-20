# Implementation Plan

1. Consume the stable Runtime renderer contract through its adapter/provider.
2. Add About update section with exhaustive state/action projection.
3. Add center update notice and About navigation.
4. Add active-work install confirmation and inline error/retry.
5. Add synchronized English/Chinese copy.
6. Verify keyboard/focus/reduced motion/light/dark/minimum window in Electron.

Validation: focused presentation tests only where state projection is nontrivial,
`pnpm typecheck`, `pnpm build`, focused Electron workflow, and screenshot review.
