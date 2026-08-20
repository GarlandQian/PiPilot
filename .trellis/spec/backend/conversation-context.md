# Conversation Context Contract

## 1. Scope / Trigger

Use this contract whenever PiPilot persists or changes the active project or
projectless conversation, creates/opens an official Pi session, or launches the
integrated terminal. It is the single active-scope source for Main, preload, and
renderer state.

## 2. Signatures

```ts
navigation.initialize(): ConversationNavigationSnapshot
navigation.get(): ConversationNavigationSnapshot
navigation.setActiveScope(scope): ConversationNavigationSnapshot

context.start(): Promise<LocalPiRuntimeSnapshot>
context.newConversation(scope, confirmed?): Promise<ConversationActivationResult>
context.openConversation(scope, token, confirmed?): Promise<ConversationActivationResult>

terminal.create(scope, cols, rows): Promise<TerminalSession>
terminal.disposeScope(scope): Promise<void>
```

## 3. Contracts

- The active scope is exactly `{ kind: 'project', workspaceId }` or
  `{ kind: 'projectless' }`. Fresh state is projectless.
- Persist `activeScope` only in `conversation-navigation.json`. The project
  repository persists only explicitly selected project records; it has no
  persisted `currentId`, session pins, session directory, or private chat row.
- A project scope resolves only through its saved opaque workspace ID. A
  projectless scope resolves only to `userData/general-chat/workspace`, created
  on first preparation. Do not infer home, a Git root, or another cwd.
- Publish the target scope only after official Pi activation/open succeeds.
  A missing persisted project falls back to projectless during startup.
- A new conversation in an already active ready scope sends official
  `new_session`. Entering another scope uses the session created by that fresh
  Pi process and does not create a second blank session.
- Every saved project exposes one stable project-owned New session route even
  when its catalog already contains rows. Empty-state shortcuts and the stable
  project menu route call the same renderer callback and therefore preserve the
  active-scope `new_session` versus cross-scope fresh-process distinction.
- Opening an opaque catalog token, creating a session, and switching scope use
  one serialized context lifecycle. Streaming/compacting replacement requires
  the explicit UI confirmation contract.
- After a successful session-changing Runtime command, carry the active scope
  from the exact source generation to the authoritative resulting generation.
  Do not let a generation change make the currently selected conversation look
  inactive to later new-session, catalog, or deletion operations.
- Terminal renderer contracts contain the typed scope, dimensions, terminal
  ID, and data only. Main resolves the root; neither project nor projectless cwd
  is returned in terminal sessions/events.
- Dispose the old scope's PTY when a successful conversation switch makes it
  inactive. Terminal input/events from a stale scope are rejected or ignored.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Fresh navigation file missing | Create current v1 document with projectless scope |
| Unknown/widened/old navigation shape | Recover as fresh projectless; no migration |
| Persisted project unavailable at startup | Prepare and activate projectless, then persist fallback |
| Pi is streaming/compacting and confirmation is false | `CONVERSATION_SWITCH_REQUIRES_CONFIRMATION` |
| Embedded Host start fails | typed `PiRuntimeFrontendError`; do not publish target scope |
| Terminal scope differs from active navigation | `TERMINAL_STALE_SCOPE` |
| Terminal scope root changes identity | Reject operation; do not write to the PTY |

## 5. Good / Base / Bad Cases

- Good: fresh launch prepares the private projectless cwd, Pi owns its normal
  session storage, and a project appears only after folder-picker selection.
- Base: Pi is missing. Navigation still says projectless and terminal can use
  the private cwd; starting a conversation surfaces the typed crashed/error snapshot.
- Bad: derive active scope from `workspace.currentId`, persist `sessionPins`,
  pass `cwd` from renderer terminal code, or publish navigation before Pi
  confirms the target session.

## 6. Tests Required

- Current-only navigation persistence, strict old/widened-shape rejection, and
  fresh projectless default.
- Missing-project startup fallback, in-place `new_session`, cross-scope fresh
  activation, confirmation, and publish-after-success.
- Populated-project UI routing reaches the exact saved workspace ID without
  introducing a second creation API or redundant blank Session.
- Project and projectless terminal cwd resolution, path-free responses,
  concurrent reuse, stale-scope input, bounded output, and scope disposal.
- IPC/preload schemas reject cwd/path fields and preserve typed scopes.

## 7. Wrong vs Correct

Wrong:

```ts
const cwd = workspace.current?.path ?? homedir()
terminal.create(workspaceId, rendererCwd, cols, rows)
persist({ currentId, sessionPins, recent })
```

Correct:

```ts
const scope = navigation.get().activeScope
const resolved = await scopeResolver.prepare(scope)
await host.start({ scope, sessionFile: undefined })
await terminal.create(scope, cols, rows)
```
