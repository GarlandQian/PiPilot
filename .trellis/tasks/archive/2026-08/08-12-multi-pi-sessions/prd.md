# Run Multiple Pi Sessions Concurrently

## Goal

Allow PiPilot to keep more than one Pi task running at the same time. The user
should be able to switch the foreground conversation while other Pi sessions
continue in the background, with independent status, output, and stop controls.

## Confirmed Facts

- Pi's `--mode rpc` is a process integration protocol. Multiple independent Pi
  processes can be alive concurrently when they use distinct session files.
- The installed Pi session manager does not provide a cross-process lock for a
  session JSONL file. Two active writers must therefore never share one session
  file.
- PiPilot currently creates one global `LocalPiRuntimeHost` in
  `src/main/index.ts:236`.
- `LocalPiRuntimeHost` owns a singular `active` child in
  `src/main/local-pi/local-pi-runtime-host.ts:180`; replacement aborts and
  stops the previous child before spawning the next one.
- Local Pi IPC commands route to that singleton without a runtime identity in
  `src/main/ipc/register-local-pi-ipc.ts:239`.
- The renderer's `PiRpcProvider` currently owns one runtime/session projection
  in `src/store/pi-rpc.tsx:353`.
- PiPilot already models project and projectless conversation scopes and has a
  read-only session catalog. The parallel feature must preserve Pi's ownership
  of session files and the existing official RPC boundary.
- A distinct Pi session file isolates conversation history and runtime state,
  but it does not isolate the project files visible through `cwd`. Two tasks
  using the same checkout still share source files, the Git index, build
  outputs, ports, and other directory-scoped resources.
- Codex's documented desktop worktree model uses one managed Git worktree per
  chat, normally at `$CODEX_HOME/worktrees/<id>` and usually in detached HEAD.
  Local and Worktree are workspace bindings; foreground/background describes
  which chat is being presented or kept running, not which binding it uses.
  Handoff moves the chat and its code between them. See the official
  [Codex Worktrees documentation](https://developers.openai.com/codex/environments/git-worktrees).
- Codex also explicitly exposes `Local` as direct execution in the current
  project directory, and its subagent documentation permits parallel agent
  workflows while warning that parallel write-heavy work can conflict. The
  public documentation does not state that every Local chat is automatically
  serialized or automatically assigned a worktree.
- Local inspection of Codex's process records found 13 distinct conversation
  IDs and 155 command/process records associated with one cwd. This confirms
  that multiple tasks can be represented against the same cwd, but the records
  mix historical and active entries and do not prove simultaneous writes to the
  same file.
- PiPilot's current session overflow menu is implemented in
  `src/components/layout/SessionList.tsx` and currently contains Rename,
  Duplicate, and Delete. It has no workspace action yet. The menu is exposed
  from the row's `...` button and is already the correct ownership boundary for
  session-scoped actions.
- Codex's public documentation verifies the semantics of Worktree and Handoff,
  and its changelog verifies thread rename, pin, fork, archive, and Handoff
  capabilities. The public docs do not publish a complete right-click menu
  inventory, so PiPilot must not describe its proposed menu as a verbatim copy
  of Codex's menu.
- Codex's environment picker allows a new chat to start directly in `Worktree`,
  and a Codex-managed worktree is normally dedicated to that chat. Therefore a
  Worktree-backed session is a first-class starting state, not merely a
  background destination after a Local session already exists.

## Deep Research Notes

The official Codex documentation confirms that `Local` and `Worktree` are
different environment choices: Local works directly in the current directory,
while Worktree provides a separate Git checkout. It does not publish a
same-directory writer mutex or promise conflict-free edits for Local. The
subagent documentation explicitly recommends more caution for parallel
write-heavy workflows because agents editing at once can conflict. A permanent
worktree is an explicit exception that allows multiple chats to share one
long-lived checkout. These details are recorded in
`research/codex-worktree-model.md`.

For PiPilot this means the product contract must separate logical task count
from actual process/resource capacity: no artificial ceiling of two, but no
promise of unlimited OS/provider capacity. It must also separate a Git
worktree's file isolation from Pi's exclusive session-file lease and from shared
credentials, ports, MCP state, and caches.

## Requirements

### Task and runtime model

- Main owns a registry of independent Pi task records and runtime hosts keyed by
  opaque `taskId` / `runtimeId` values. Task creation is not capped at two.
- Each runtime has an immutable target tuple for its lifetime: session file,
  conversation scope, cwd, executable path, and lifecycle generation.
- Each session/task persists an explicit workspace binding separate from its Pi
  session identity: `workspaceMode` (`localShared`, `worktree`, or `external`),
  canonical `cwd`, and (when applicable) worktree id/path, source branch/commit,
  and ownership. The UI must never infer Worktree state only from a path string.
- Commands, events, extension UI requests, diagnostics, and stop operations
  are routed by `runtimeId`; output from one runtime must never update another.
- Switching the foreground session changes presentation only and does not
  abort background runtimes.
- PiPilot exposes three explicit workspace modes: `Local/shared` (the current
  checkout, multiple runtimes allowed with an explicit conflict warning),
  `Worktree/isolated` (one managed Git worktree per task), and `External
  directory` (a user-selected different `cwd`). A different session file is
  sufficient to start another runtime in `Local/shared`, but it is not a
  guarantee that overlapping source edits will merge safely.
- The pool exposes per-runtime status (`queued`, `starting`, `ready`,
  `running`, `waiting`, `stopping`, `stopped`, `crashed`) and individual stop.
- There is no product-level limit of two tasks. Users can create multiple
  independent tasks, and each task owns its own Pi process/runtime just as the
  Codex-style task model does.
- **Recommended Codex-style mode:** a task created in a Git repository may start
  directly as a Worktree session, or stay in `Local/shared` until the user
  chooses the session-menu action `在 Worktree 中继续`. A direct Worktree start
  creates one managed worktree from the selected starting commit, uses a unique
  detached HEAD (or a unique branch only when the user explicitly creates one),
  and records the session/worktree association before Pi starts. Returning to
  the foreground checkout is also an explicit, conflict-checked Handoff;
  background/parallel status alone never silently changes the task's `cwd`.
- Codex also has a separately created permanent-worktree mode where a user may
  start multiple chats from one long-lived checkout. That is an explicit,
  higher-conflict mode; it is not the default managed-worktree behavior and is
  out of the PiPilot MVP.
- Worktree lifecycle is visible: path, source commit/branch, task association,
  cleanup eligibility, and unsaved/uncommitted changes. PiPilot must never
  silently delete a worktree containing changes.
- For non-Git directories, `Local/shared` remains available because it is a
  direct-cwd capability rather than a Git feature. The UI must make the shared
  directory and its conflict risk explicit; `Worktree/isolated` is unavailable
  and `External directory` is the safe alternative when isolation is required.
- Main may expose an optional resource guard (maximum active processes) for
  machines or providers that need it. When configured, excess tasks queue
  deterministically; when disabled, starts proceed concurrently until the
  operating system or provider rejects them. Changing this guard must not
  change the `runtimeId` IPC identity contract.

### Session and workspace safety

- A session file may have at most one PiPilot runtime lease at a time. Duplicate
  starts fail with an actionable conflict instead of spawning a second writer.
- The implementation must not invent a parallel session directory or rewrite
  Pi's session format.
- Parallel tasks with different session files and the same cwd are supported in
  the first release as an explicit `Local/shared` mode. PiPilot must not claim
  file-level locking, automatic patch merging, or conflict-free results there.
- Same-project Git tasks may opt into one isolated managed worktree per task.
  Only that mode promises that the original checkout is not mutated by the
  background task; it is not a prerequisite for starting a Local task.
- App shutdown, project removal, Pi executable changes, and global Pi/MCP
  restart operations stop or drain every affected runtime, not just the
  foreground one.

### Session context menu and workspace actions

- The session row's existing `...` menu is the single entry point for
  session-scoped actions. A native context-menu event and the keyboard
  context-menu key must open the same menu model; there must not be a separate
  mouse-only action set.
- The menu is grouped in this order:
  1. **Workspace**: `在 Worktree 中继续` / `Continue in Worktree` for a Local
     session, `打开 Worktree` / `Open Worktree` for a Worktree session, and
     `返回 Local` / `Return to Local` for an explicit Handoff back to the
     original checkout.
  2. **Session**: `复制会话` / `Duplicate session`, `重命名` / `Rename`,
     `固定` or `取消固定` / `Pin` or `Unpin`, and `归档` / `Archive` when
     archival persistence is available.
  3. **Danger**: `删除` / `Delete`, separated and confirmation-protected.
- The right-click menu deliberately does **not** contain `停止任务` / `Stop
  task`. Stop is a runtime control and belongs in the active-run control,
  chat header, or a unified running-tasks panel; removing it from the menu
  avoids mixing an immediate process action with session management.
- `在 Worktree 中继续` is a Handoff, not a duplicate. It preserves the
  conversation identity and session history, stops or pauses the active Pi
  runtime at a safe boundary, creates or reuses the session's dedicated Git
  worktree, and resumes with the new canonical `cwd` only after Main confirms
  the workspace transition. The same transition is available before first run
  through the new-session Worktree choice.
- `复制会话` remains a separate operation. It creates a new session identity
  and may be started in `Local/shared` or `Worktree/isolated` through an
  explicit destination choice; it must never reuse the source session file.
- A Local session in a Git project shows the Worktree action enabled. For a
  non-Git project the item remains visible but disabled with an actionable
  explanation such as `Worktree requires a Git repository`; the alternative is
  choosing an external directory or staying in `Local/shared`.
- New-session creation exposes the workspace choice before launch: `Local`,
  `Worktree` (only for Git projects), or `External directory`. The selected
  choice is shown in the session row and is not silently changed by whether the
  task is foreground or background.
- A Worktree session shows a compact workspace badge in the row and changes the
  menu to `打开 Worktree`, `返回 Local`, and (only when safe) `移除 Worktree`.
  Removing a worktree with uncommitted changes is blocked or requires an
  explicit recoverable flow; it is never silent cleanup.
- Handoff and removal are Main-owned operations. The renderer dispatches an
  intent keyed by `taskId`/`runtimeId` and renders progress, conflict, success,
  and failure states from Main. The renderer must not run Git commands or
  mutate session files.
- Menu labels, disabled reasons, status badges, and confirmation dialogs are
  localized in both catalogs. The menu remains keyboard navigable with a
  visible focus ring and returns focus to the session row after dismissal.

### Renderer and persistence

- The renderer keeps one selected-session detail projection and a lightweight
  runtime-summary map for background rows; it must not mount a full RPC
  provider per sidebar row.
- Sidebar/session rows show which tasks are running in the background and allow
  selecting or stopping an exact runtime.
- Runtime summaries survive renderer reload while Main remains alive. A full
  automatic resume after app restart is out of scope for the first release.

## Acceptance Criteria

- [ ] Two distinct session files can be started concurrently and both reach
      ready/running without aborting each other.
- [ ] A prompt/event sent to runtime A cannot appear in runtime B's transcript,
      status, dialogs, or diagnostics.
- [ ] Selecting runtime B while runtime A is running leaves A running; stopping
      A does not stop B.
- [ ] Starting the same session file twice is rejected and leaves the original
      process untouched.
- [ ] Two distinct session files can run concurrently with the same canonical
      `cwd`; the UI identifies this as `Local/shared` and shows a conflict-risk
      warning without silently rejecting the second runtime.
- [ ] When an optional active-process limit is configured, an excess start is
      queued and starts after one slot is released; with the guard disabled,
      multiple independent tasks can start without an artificial two-task
      ceiling.
- [ ] App shutdown disposes all child processes and leaves no owned runtime
      handles behind.
- [ ] Different-workspace parallel tasks pass the manual workflow: start A,
      start B, switch between them, observe independent output, stop one, and
      finish the other.
- [ ] When `Worktree/isolated` is selected, two tasks started from the same Git
      project receive different worktree paths and cannot mutate the original
      checkout while running in parallel.
- [ ] A task can be explicitly handed from its managed worktree to the
      foreground checkout only after conflict checks; the reverse handoff
      returns it to the same associated worktree.
- [ ] A Git-backed Local session exposes `在 Worktree 中继续` in both the row
      overflow menu and the keyboard context-menu path; selecting it creates or
      reuses the associated worktree and resumes the same session identity after
      a visible transition state.
- [ ] New-session creation can start directly in a Worktree; the resulting
      session row shows the Worktree binding before the first Pi prompt and can
      be reopened with the same associated worktree.
- [ ] A Worktree-backed session exposes `打开 Worktree` and `返回 Local`; the
      return action performs conflict checks and never silently overwrites
      Local changes.
- [ ] A non-Git session keeps the Worktree item visible but disabled with a
      localized reason and an actionable alternative.
- [ ] Duplicate, rename, pin/unpin, archive, and delete remain distinct
      actions with correct recoverability behavior; the right-click menu does
      not expose Stop, and Delete cannot silently remove an active or dirty
      worktree.
- [ ] Worktrees with uncommitted changes are retained and never silently
      removed; cleanup requires an explicit user action or a documented,
      recoverable policy.
- [ ] Tests cover pool lifecycle, runtimeId routing, stale event isolation,
      duplicate session-file rejection, queue draining, and shutdown cleanup.
- [ ] `pnpm typecheck`, focused Vitest coverage, and `pnpm build` pass.

## Out Of Scope

- Multiple Pi processes writing the same session file.
- File-level conflict-free merging for multiple autonomous writers in the same
  physical directory. `Local/shared` is supported, but overlapping edits remain
  an explicit user risk.
- Embedding Pi's SDK in Electron or creating a second agent protocol.
- Automatic recovery/resume of every runtime after the application restarts.
- Cross-device or remote worker scheduling.
- Cost governance or provider-specific rate-limit orchestration beyond a
  bounded local process pool.

## Product Decision Needed

Recommended decision: treat workspace binding as a property of every session.
At creation, offer `Local/shared`, `Worktree/isolated` (for Git projects), or
`External directory`; keep `Local/shared` as the lightweight default, and make
Worktree the explicit recommended choice for tasks likely to overlap files. A
session may later Handoff between Local and its dedicated Worktree without
changing its conversation identity.

The remaining product decision is whether to approve this shared-Local plus
optional-Worktree policy and the Handoff wording for the first release.
Choosing Worktree-only or making the action a fork instead would provide a
different conflict and history model, even though both can be implemented from
the same menu entry point.
