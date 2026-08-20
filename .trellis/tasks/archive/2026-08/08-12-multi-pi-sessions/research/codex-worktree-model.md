# Codex Worktree Model Research

Date: 2026-08-12

Primary source: [Codex Worktrees documentation](https://developers.openai.com/codex/environments/git-worktrees)

## Verified behavior

- Codex uses Git worktrees to give independent chats separate checkouts so they
  can run in parallel without the checkouts interfering with one another.
- A worktree is a separate checkout with its own files and index while sharing
  the repository's Git metadata. Worktrees require a Git repository.
- In the desktop chat flow, `Local` works directly in the current project
  directory and `Worktree` isolates changes in a Git worktree. The user
  explicitly selects the environment when starting a chat; scheduled tasks in
  Git repositories use dedicated worktrees. A Worktree chat can be the current
  foreground chat; “background” is a presentation/lifecycle state, not a
  synonym for Worktree.
- A new chat can start directly in `Worktree`; Worktree is therefore a
  first-class session environment, not only a later destination for a Local
  chat. The same chat can subsequently move between Local and Worktree through
  Handoff.
- Codex documents parallel subagent workflows and separately warns that
  write-heavy parallel agents can conflict. The public docs do not state that
  Local chats are automatically serialized or that every Local task gets a
  worktree.
- A Codex-managed worktree is normally dedicated to one chat. The same chat is
  returned to that worktree after a later handoff. A permanent worktree is a
  separate, explicit mode in which multiple chats may share one long-lived
  checkout.
- Managed worktrees are created under `$CODEX_HOME/worktrees` from the selected
  branch's `HEAD`, normally in detached `HEAD` state. If the selected branch
  has uncommitted changes, Codex applies those changes to the new worktree.
- Ignored local files are not copied by default. A repository-level
  `.worktreeinclude` can list ignored files such as `.env.local`; tracked files
  already exist in the checkout. Source symlinks are skipped and existing files
  are not overwritten.
- Handoff moves the chat and code between Local and Worktree. It accounts for
  Git's rule that a named branch cannot be checked out in two worktrees at the
  same time.
- Codex keeps a default of the most recent 15 managed worktrees and can save a
  snapshot before automatic deletion. This is disk-usage retention, not an
  active-task or model-process concurrency limit.

## What the source does not establish

The official page does not promise unlimited simultaneous model/API processes,
nor does it publish a fixed active-process ceiling. Operating-system capacity,
provider rate limits, and application-level resource guards remain separate
concerns. Therefore, “not capped at two” should mean no PiPilot-imposed limit
of two, not a guarantee that every machine or provider can run unlimited
tasks at once.

The official sources also do not establish a file-level mutex, patch-merge
protocol, or conflict-free guarantee for multiple Local writers. A same-cwd
Local run is therefore a supported capability with shared-file risk, not an
isolation guarantee.

## PiPilot implications

PiPilot should model these as separate concepts:

| Concept | Recommended PiPilot interpretation |
| --- | --- |
| Task | User-visible conversation/work item |
| Runtime | One `pi --mode rpc` process bound to exactly one task |
| Session lease | Exclusive ownership of one Pi session file |
| Workspace | Original checkout, managed worktree, or explicitly different cwd |
| Foreground | Renderer presentation selection only; does not stop other runtimes |
| Handoff | Explicit, conflict-checked workspace move; never an implicit cwd swap |

For PiPilot, `Local/shared` should allow different session files to run in the
same cwd with a clear conflict warning. `Worktree/isolated` should remain the
explicit choice for file isolation, and `External directory` the safe choice
for non-Git projects that need isolation. Shared credentials, ports, MCP state,
caches, and other external resources still need independent guards because a
Git worktree does not isolate them.

## Session-menu evidence and design boundary

The public Codex worktree page verifies `Handoff` as the operation that moves a
chat and its code between Local and Worktree. The Codex changelog also mentions
thread renaming, pinning, forking, archiving, and Handoff. A help article
confirms that the conversation overflow button opens archive/delete actions.
Neither source publishes the complete current right-click menu, so the exact
PiPilot menu list is a product design, not a claim that every item is present in
Codex.

PiPilot's existing row menu already owns Rename, Duplicate, and Delete. The
recommended extension is to add a Workspace group with `Continue in Worktree`,
`Open Worktree`, and `Return to Local`, while keeping Duplicate as a separate
new-session operation. New-session creation must also offer Worktree before the
first run; a Worktree-backed session is not required to pass through Local.
Worktree transitions must be Main-owned and keyed by task/runtime identity; the
renderer only dispatches intents and displays state.
Stop is intentionally excluded from that menu in PiPilot. It is a runtime
control and should stay in the active-run control/header or running-tasks
surface, so a context-menu action cannot accidentally terminate work while a
user is managing session metadata or workspace location.

## Pi-specific verification

The installed Pi 0.84.1 RPC documentation and implementation add an important
constraint. RPC supports `--session`/`--fork` for an explicit session file and
`--session-dir` for storage; when no custom directory is passed, the default
directory is derived from the resolved `cwd`. The session manager persists by
opening and appending the JSONL file directly and does not expose a
cross-process lease in the implementation inspected here. Pi also documents
`fork`/`clone` as the operations that create a new session file; `tree` keeps
one file.

Consequences:

- A worktree alone does not make two runtimes safe if both are launched with
  the same explicit `--session` path. PiPilot needs an atomic runtime lease
  keyed by canonical session-file path.
- Creating a background task from an existing conversation should use Pi's
  supported `--fork`/`clone` semantics (or a new session), never copy or edit a
  JSONL file by hand.
- If PiPilot changes `cwd` to a managed worktree while retaining an existing
  session path, the session header still records the old cwd. That may be
  intentional for continuation, but it must be an explicit data-flow decision;
  it is not an automatic consequence of Git worktree creation.
- Pi's default session directory is cwd-derived, so a new worktree naturally
  gets a different default session root only when PiPilot lets Pi choose the
  session path. PiPilot currently owns workspace-specific session roots, so
  the future runtime registry must preserve that ownership model or document a
  deliberate migration.

## Remaining product decision

Confirm whether PiPilot should ship `Local/shared` plus optional
`Worktree/isolated` with `Continue in Worktree` as a same-session Handoff. The
alternative is a stricter Worktree-only policy or a fork-to-Worktree action,
which changes the conflict and conversation-history semantics.
