# Windows session and package-management root-cause evidence

Date checked: 2026-08-14. This document records planning evidence only; no
product code was changed while gathering it.

## 1. Missing project-owned new-session action

- `src/components/layout/SessionList.tsx` gives `ProjectNavigationGroup` an
  `onStartProjectTask(projectId)` callback.
- `ProjectChildren` renders the callback only as `sidebar.project.startTask`
  when a ready project has zero scoped session rows.
- When rows exist, `ConversationList` replaces that shortcut.
- The project DropdownMenu exposes only Open and Pin/Unpin. Therefore the
  photographed project with existing sessions has no direct new-session action.
- `src/App.tsx` already wires `onStartProjectTask(workspaceId)` to
  `workspace.newSession({ kind: 'project', workspaceId }, confirmed)`, so the
  correct repair is to expose the existing route in the project menu rather
  than create a new API.

## 2. Existing creation semantics are not the reported defect

- `src/main/conversations/conversation-context-service.ts` computes
  `reuseCurrentSession` before activation and sends official `new_session` only
  when the requested scope is already active and ready.
- The user clarified that the blocker is the missing UI location, not this
  reviewed distinction. The current unit test intentionally encodes it: a new
  target process owns a fresh Session, while creating again in the active ready
  scope sends `new_session`.
- The implementation must preserve this behavior and simply expose the existing
  project-scoped action consistently. Adding another `new_session` after a
  cross-scope start would manufacture an unnecessary blank Session.

## 3. Existing-session first-click hydration

- `workspace.openSession` calls the Main catalog with the row's opaque token,
  applies the confirmed activation identity, and lets PiRpc hydrate the
  transcript independently of slower catalog refresh.
- `App` owns a selection operation ID/opening handle and
  `piGenerationHydrationOutcome` requires exact scope/generation/session
  agreement.
- The official renderer spec already forbids early empty/ready presentation and
  stale transcript/inspector data. The regression must instrument the full
  interaction boundary through fixture `get_messages`, because process startup
  alone does not prove message loading.
- The existing Windows packaged smoke currently proves a `.cmd` launcher can
  start chat but does not prove project creation, catalog selection, or message
  hydration in the packaged product.

### Windows-only activation boundary

- `src/main/local-pi/local-pi-spawn.ts` applies npm-shim double escaping only
  when the command path matches `node_modules\\.bin\\*.cmd`.
- A real fnm global npm shim lives at the Node installation root, for example
  `...\\installation\\pi.cmd`, but still uses npm's nested `cmd.exe` batch
  grammar and `%*` forwarding.
- Simple version/startup arguments may survive the generic branch. Existing
  Session activation introduces `--session <absolute-jsonl-path>`, so spaces,
  parentheses, and `&` expose the missing second escaping layer. A changed path
  prevents Main's exact returned session-file/ID confirmation and therefore
  prevents renderer `get_messages` hydration from settling.
- This is source-confirmed as a classifier mismatch and is the highest-
  confidence Windows-specific explanation. The exact corrupted character must
  still be proven by a native Windows child-observed argv trace before claiming
  the fix complete.

## 4. Windows npm/fnm command shim mismatch

- The reported working Pi executable is an fnm global shim under
  `...\\AppData\\Local\\fnm\\node-versions\\v24.14.0\\installation\\pi.cmd`.
- `LocalPiExecutableService` intentionally discovers `.cmd` and the spawn layer
  runs it through `cmd.exe`; normal RPC therefore works.
- `LocalPiPackageLocator` canonicalizes that `.cmd` and walks only its ancestor
  manifests, requiring the selected file itself to equal the package-declared
  bin. A root-level npm shim cannot satisfy that test, so Integrations reports
  management unavailable.
- npm's installed `cmd-shim` implementation generates a bounded batch program
  around a `%dp0%`-relative package bin target. This is machine-generated
  executable metadata, not human Pi CLI output.
- A safe enhancement can parse only that generated relative target, derive its
  exact package root, and then reuse every existing package name/version/bin/
  export/containment check. Arbitrary wrappers and broad global searches remain
  rejected.

## 5. Release evidence gap

- The checked-in packaged test creates a generic temporary `.cmd` wrapper and
  proves runtime startup/packaging properties.
- It does not provide an importable package root and therefore cannot detect the
  package-management failure.
- Its two-line `.cmd` is not npm's generated `_prog`/`%dp0%\\node.exe`/`%*`
  grammar and therefore cannot detect the runtime escaping mismatch.
- It also does not exercise the project menu, `new_session`, catalog open, or
  persisted `get_messages` flow.
- The replacement `0.0.1` release therefore requires an fnm/npm-shaped checked-
  in fixture plus native Windows packaged UI assertions before publication.

## 6. Prevention contracts

- Release smoke must validate user outcomes at the real layer boundary, not
  infer package management or transcript hydration from successful Pi startup.
- The project-owned creation route must stay visible regardless of row count and
  reuse the existing reviewed lifecycle rather than duplicate it.
- A project-level action must remain present independent of loaded row count.
- Version-manager command shims are supported only when they cryptographically/
  structurally bind to the already selected exact package; otherwise fail
  closed without breaking chat.

## 7. Break-loop analysis

### Root-cause categories

- **Boundary mismatch:** runtime spawn and package management classified the
  same Windows executable with different rules.
- **Path-shaped assumption:** npm shim behavior was inferred from
  `node_modules/.bin`, excluding equivalent fnm/npm global-prefix shims.
- **Coverage gap:** the packaged smoke proved startup with a simplified wrapper
  but did not cross project creation, Session selection, transcript hydration,
  or package discovery.
- **UI lifetime mismatch:** the project-owned creation action existed only in
  the empty-child state, so adding the first Session removed the action.

### Why earlier checks passed

- Version and basic RPC arguments did not contain the shell metacharacters that
  expose the nested `cmd.exe` parsing boundary.
- A macOS direct-module Electron fixture could not reproduce Windows batch
  forwarding.
- The Windows packaged fixture had no importable package root and therefore
  could not prove Integrations.
- UI coverage asserted the empty-project shortcut, not the populated-project
  menu.

### Prevention matrix

| Failure class | Durable prevention |
| --- | --- |
| Equivalent npm shim at a different prefix | Structural bounded resolver shared by spawn and package locator |
| Session path corruption | Native Windows child-observed argv with spaces, parentheses, `&`, and Unicode |
| False package-management unavailable | Same fixture exposes exact importable package and asserts packages/resources |
| New-session action disappears | Stable project menu action plus populated-project keyboard E2E |
| Mock-only confidence | Native packaged workflow verifies the complete user outcome before release |

## 8. Native teardown finding

The first `windows-2025` execution completed the product assertions but failed
while removing the temporary project with `EBUSY`. The packaged test had closed
the CDP browser connection and then killed Electron without waiting for the
application's `before-quit` disposal path or its child Pi process to exit. That
left a process whose current working directory was the temporary project.

Packaged acceptance now closes the real BrowserWindow first, waits for the
application's bounded shutdown, escalates termination only when necessary, and
waits after the final forced termination. Recursive cleanup has a bounded
Windows retry for transient file locks; a persistent process leak still fails
the test.
