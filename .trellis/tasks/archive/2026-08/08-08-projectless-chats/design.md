# Technical Design

## Context Ownership

Introduce one current-only contract:

```text
ConversationScope =
  | { kind: 'project'; workspaceId: UUID }
  | { kind: 'projectless' }
```

`ConversationContextService` resolves it in Main:

```text
project
  cwd   = canonical directory explicitly selected by the user
  label = saved project name

projectless
  cwd   = userData/general-chat/workspace
  label = localized general-chat label
```

The renderer receives the scope discriminator and IDs/labels, never the private
or project filesystem path. `WorkspaceRepository` stores only explicitly chosen
projects. A new current-schema navigation repository stores `activeScope`; its
fresh default is projectless. No prior schema parser or migration branch exists.

## Startup And Switching

App startup resolves the persisted current scope, falls back to projectless only
when a selected project is unavailable, creates the active scope's required
directories, and starts the selected latest official Pi. It never falls back to
the home directory or discovers a project.

Every scope/session switch is one serialized replacement transaction:

1. confirm/abort an active run through the existing UI contract;
2. invalidate the old process generation and dispose old terminal subscriptions;
3. resolve the target entirely in Main;
4. create the private cwd only when the target is projectless;
5. spawn latest `pi --mode rpc --approve` and optional `--session ...`, never
   `--session-dir`;
6. hydrate state/messages/commands/stats from official RPC;
7. learn the actual session directory from `get_state.sessionFile` for catalog
   navigation;
8. publish the new active scope after successful activation.

Failure leaves a recoverable target error and cannot populate the UI with prior
scope state.

## Project Resource Boundary

Only the user-selected project path is used for a project process, so its local
`.pi`, `.agents`, `AGENTS.md`, and Git working tree are the project context.
Projectless runs in the private general-chat directory, which PiPilot keeps free
of project settings/context files. Pi's global Agent directory and globally
installed plugins continue to load through normal official discovery.

## Desktop Data Flow

The official session catalog returns projectless summaries to a dedicated
`recentChats` Store lane. Project tasks and projectless chats share row/action
types but retain scope discriminators. Session messages/stats remain official
generation-scoped runtime state, not catalog data.

Pi owns the session root for both kinds of scope. The catalog may retain the
last directory observed from official state, but PiPilot has no session-directory
setting and never exposes or rewrites that path.

File tree, Diff, Git branch, and workspace `@` selectors require
`scope.kind === 'project'`. Terminal targets a typed conversation scope and uses
the resolved cwd; the renderer cannot pass the private path. General-chat files
persist naturally in its private workspace.

The split creation control calls explicit `newProjectTask(workspaceId)` or
`newProjectlessChat()` operations. It never decides a cwd in the renderer.

## Fresh-State And Rollback

This design intentionally has no compatibility with current development-only
paths or documents. The implementation deletes old code/schema handling but
does not inspect or mutate external old app data. Before release, rollback is a
code revert; there is no downgrade/migration protocol.
