# Product

<!-- impeccable:product-schema 1 -->

## Platform

Electron desktop application; desktop-class windows, no web or mobile target.

## Users

Software developers who use the Pi coding agent daily and drive it through
PiPilot instead of the terminal TUI. They keep the app open for hours, run
many sessions per day, and operate primarily by keyboard.

## Product Purpose

PiPilot is the local desktop client for the official Pi coding agent. It embeds
the exact pinned Pi SDK in supervised Electron utility processes, presents
sessions, diffs, terminals, approvals and MCP configuration as a fast
native-feeling GUI, and keeps Pi-owned Sessions/configuration in Pi's own files
and formats. A separate, opt-in inbound External Control integration lets
trusted current-user MCP clients inspect bounded conversation metadata and
submit operations through Main without Renderer IPC or a network listener.
Success means a developer can supervise multiple agent sessions, review
changes, adjust configuration, and automate exact conversations without the
app ever inventing a second Pi data format.

## Positioning

PiPilot is Pi-native, not a generic agent UI: the runtime is the bundled exact
official Pi SDK, MCP configuration edits the real JSONC documents
(`~/.pi/agent/mcp.json`, project `.mcp.json`) with comment and unknown-field
preservation, and capabilities degrade honestly when the optional
`pi-mcp-adapter` is absent. Inbound External Control is a distinct local-only
MCP boundary, disabled by default and authenticated through a current-user
descriptor. A generic chat-client clone cannot truthfully copy this contract
fidelity.

## Operating Context

- Long-lived desktop window on macOS (primary), dark and light themes,
  zh-CN and en-US locales, compact and comfortable densities.
- Core loop: pick or create a session → converse with the agent → watch
  tool calls and shell approvals → review file diffs and terminal output →
  occasionally adjust settings, models, and MCP servers.
- MCP editing happens a few times per week but must be exact: the same
  draft serves a structured form and raw JSONC editing, with fingerprint
  conflict detection and explicit Save / Save + Restart Pi.

## Capabilities and Constraints

- Renderer never touches the filesystem or Pi directly; all access goes
  through preload-whitelisted IPC to the main process. UI work must not
  widen this boundary.
- MCP `description` is not an adapter field (`ServerEntry` has none), but
  the adapter's non-strict validation preserves unknown fields, so a
  description may be stored as inert metadata and must never be silently
  dropped.
- `pi-mcp-adapter` is optional; its missing/available/error states must be
  presented truthfully. MCP is never claimed to be Pi core.
- PiPilot automatically manages only `pi-mcp-adapter`; `pi-subagents`, Plan
  Mode, and Goal remain user-managed compatibility integrations.
- External Control never exposes raw Session paths, tokens, transcript history,
  tool arguments, or Renderer IPC. Its six tool-only methods use opaque
  conversation/operation identities, bounded DTOs, idempotency, and explicit
  lifecycle/error states.
- All user-visible text is localized (zh-CN / en-US); layouts must not
  depend on fixed text widths.
- Appearance system is token-driven: theme, UI/mono font families, UI and
  code font sizes, density, reduced motion, ligatures, word wrap, line
  numbers — all applied via CSS variables without reload.

## Brand Commitments

- Product name: PiPilot; π glyph logo.
- Binding visual constraints from the owner: professional, clear, compact
  developer tool; neutral gray surfaces with exactly one low-saturation
  accent; no gradients, no glassmorphism, no neon, no decorative shadows;
  Lucide-class stroke iconography (currently Tabler via react-icons);
  readability and operation efficiency over visual flair.

## Evidence on Hand

- Working renderer with real Pi RPC integration, session catalog, composer,
  markdown pipeline, inspector (files/diff/terminal), terminal service.
- Real MCP stack: `src/shared/mcp-config*.ts`, `src/main/mcp/`,
  `src/renderer/adapters/mcp-config-adapter.ts` with JSONC round-trip and
  fingerprint conflict detection.
- Locale catalogs: `src/i18n/locales/{zh-CN,en-US}.json`.
- Do not fabricate: user counts, benchmarks, marketplace content, preset
  MCP server catalogs, or cloud features.

## Product Principles

1. Pi owns the data; PiPilot owns the experience. Never copy, migrate, or
   re-encode Pi's files into app-specific formats.
2. Keyboard-first density: every frequent action reachable without a mouse;
   information density tuned for hours of use, not first impressions.
3. Honest degradation: absent adapter, invalid JSON, conflicts, and runtime
   states are shown as they are, never smoothed over.
4. One accent, zero decoration: hierarchy comes from structure, spacing,
   and type, not color noise.
5. Compact by default; comfort is a setting, not the baseline.
