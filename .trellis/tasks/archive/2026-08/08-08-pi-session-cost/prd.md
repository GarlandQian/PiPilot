# Show Official Pi Session Cost

## Goal

Show the authoritative cost and context usage of the active local Pi session in
the chat header without estimating from visible messages.

## Confirmed Facts

- Official `get_session_stats` returns a scalar session `cost`, token totals,
  and nullable `contextUsage` for the full session, including tool-reported
  usage, compaction, and branch-summary generation.
- `ChatHeader` already has a fixed secondary-information group and renders
  context usage from legacy fields at `src/components/chat/ChatHeader.tsx:76`.
- Context values may be unavailable before a model is selected or immediately
  after compaction; this is a valid state, not zero usage.

## Requirements

- Consume only the active renderer RPC provider's latest
  `get_session_stats` result; do not sum transcript messages or cache a separate
  persisted cost ledger.
- Refresh stats after initial connection, session new/switch/fork/clone,
  `agent_settled`, compaction completion, reconnect, and explicit runtime
  restart. Coalesce duplicate refreshes and reject stale generation/session
  responses.
- Add a stable-width compact amount next to context usage in the header. Format
  official cost as USD with enough precision for sub-cent sessions and
  locale-aware digits; use an empty-state dash while unavailable, not `$0.00`.
- Provide a tooltip with full amount, input/output/cache/total token counts, and
  current context tokens/window/percent when supplied by Pi.
- Keep the header scannable at narrow widths: amount and context remain in the
  secondary group, labels truncate or hide responsively, and title/control slots
  do not shift when stats load.
- Reset visible stats immediately when the active workspace/session generation
  changes so totals from the prior session are never shown under a new title.
- Do not add a billing database, currency conversion, budget alerts, or provider
  reconciliation.

## Acceptance Criteria

- [ ] Header amount exactly reflects `get_session_stats.data.cost` for the
      active session and is never computed from visible turns.
- [ ] A cost below one cent remains distinguishable from zero, ordinary amounts
      use concise USD formatting, and unavailable stats render a stable dash.
- [ ] Tooltip token and context values match the same official stats response.
- [ ] New/switch/fork/clone/reconnect/compaction/settled events refresh once
      after coalescing and a stale response cannot update a replacement session.
- [ ] Null/omitted `contextUsage` after compaction does not create `NaN`, a false
      zero, division errors, or layout movement.
- [ ] The header remains usable at supported narrow/desktop widths with aligned
      left/right toggles and no overlapping title, model, usage, status, or cost.
- [ ] Focused formatting/state checks, typecheck, build, and an Electron header
      scenario pass.

## Out Of Scope

- Per-provider invoices, account balances, exchange rates, budgets, alerts, or
  historical cross-session analytics.
- Estimating cost when official Pi does not report it.
- Changing Pi pricing or usage accounting.

## Dependency And Artifact Scope

This lightweight task depends on the local RPC renderer snapshot/stats contract
and owns header cost/context presentation, formatting, refresh triggers, locales,
and focused expectations. `prd.md` is sufficient; no separate design document
is required.
