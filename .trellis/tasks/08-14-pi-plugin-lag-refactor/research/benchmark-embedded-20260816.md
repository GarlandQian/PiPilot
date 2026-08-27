# Embedded benchmark — local macOS (Phase 7 slice)

- Date: 2026-08-16
- Machine: macOS arm64-ish (process.platform/process.arch recorded in script output), Node 26.5.0 (dev host), Electron 43 utility host pending
- Agent dir: real `~/.pi/agent` with the user's 9 configured packages
- Script: `research/benchmark-embedded-20260816.mjs` (temp sessionDirs only; real catalog never touched)

## Samples

| Measurement | Value |
| --- | ---: |
| CLI `pi --mode rpc` first `get_state` (9 plugins) | **3 849 ms** |
| Embedded SDK ESM import (cold, dev node) | 761 ms |
| Embedded runtime #1 (cold host) → first-ready | **2 217 ms** (2.6 ms session manager + 2 215 ms services/resources/extensions/bind) |
| Embedded runtime #2..#8 (same cwd, warm module graph) → first-ready | **19–23 ms each** |
| RSS delta after 1 runtime | 95 MiB |
| RSS delta after 8 runtimes | 100 MiB (≈5 MiB per additional runtime) |
| `switchSession` across cwd on a warm runtime | 1 398 ms (recreates cwd-bound services/extension factories) |

## Conclusions

1. The plugin penalty is paid once per Host: the cold embedded first-ready
   (import + services + extensions + bind) is ~3.0 s total, versus 3.9 s for a
   fresh CLI process per session. The per-file respawn that PiPilot previously
   did is eliminated.
2. Same-cwd additional runtime creation is effectively free (~20 ms): the
   extension module graph stays warm and only the factory/extension state runs.
   The design's "extension load paid once per host" is therefore measured, not
   hypothesized, for same-cwd concurrency.
3. Memory: one plugin-loaded runtime costs ~95 MiB; each additional same-cwd
   runtime adds ~5 MiB. The "one 312 MiB host for N runtimes" hypothesis is
   not confirmed at the dev-node level and stays open for the packaged
   Electron utility-process measurement.
4. Cross-cwd `switchSession` (~1.4 s) is materially slower than same-cwd
   runtime creation: project switches keep latency proportional to extension
   factory reactivation, so per-scope Hosts remain the right topology.

## Remaining measurements (CI / user machine)

- Packaged Electron utilityProcess timings for the same milestones.
- Packaged 1/4/8-runtime RSS/heap/external-memory comparison. These sample sizes
  are measurement points, not production capacity defaults.
- Warm CLI in-process session switching oracle (prior session measured
  new_session ~150-160 ms, switch_session ~149 ms with 9 plugins) — the
  embedded same-cwd create at ~20 ms is strictly faster.
