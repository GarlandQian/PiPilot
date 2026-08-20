# Add chat copy fork and session deletion

## Goal

Make PiPilot's conversation actions match the Codex interaction model: place
copy and fork actions at the end of chat content, simplify the sidebar session
menu, and let users delete sessions from that menu.

## Requirements

- Add a compact action row after every completed assistant response, following
  all text, tool output, and change-summary content for that response.
- The action row contains Copy and Fork icon buttons only; Codex's feedback
  buttons are outside this task.
- Copy writes that assistant response's source Markdown without sender labels,
  timestamps, tool-only UI chrome, or action metadata.
- Fork resolves the official Pi user-message `entryId` immediately preceding
  the assistant response and creates the branch from that point.
- Remove the existing fork action from the sidebar session dropdown.
- Add a delete-session action to the sidebar session dropdown.
- Delete always requires an explicit confirmation dialog. Deleting the active
  session stops its owned Pi runtime first, removes the session, clears the
  current selection, and returns to the owning project's no-session state.
- Mirror Pi's official interactive deletion behavior: try the operating-system
  trash first and fall back to permanent unlink when trash is unavailable.
- Continue using the official Pi session/runtime model for fork behavior.
- Keep all actions scoped to the selected project or projectless conversation.

## Acceptance Criteria

- [ ] Eligible chat content exposes stable copy and fork icon actions at its end.
- [ ] Copy writes the intended chat content without UI-only metadata.
- [ ] Fork uses the selected message/session entry and activates the resulting
      official Pi session without stale transcript data.
- [ ] Fork acts immediately on the response's preceding official user entry;
      the old fork-message picker is removed and the returned Pi text becomes
      the new Composer draft through the existing official flow.
- [ ] The sidebar session dropdown no longer contains Fork and contains Delete.
- [ ] Deleting one session refreshes only the owning scope's catalog and cannot
      delete a session from another project or projectless scope.
- [ ] Active deletion stops the matching runtime, removes the exact selected
      file, clears all session-owned renderer data, and leaves the project
      selected with no session selected.
- [ ] Inactive deletion does not stop or replace the current Pi runtime.
- [ ] Deletion reports whether trash or unlink completed the operation and
      never exposes the session path to the renderer.
- [ ] Loading, failure, active-session deletion, and unavailable-session states
      have explicit non-overlapping UI behavior.

## Confirmed Constraints

- PiPilot is Electron-only and currently uses the official local Pi 0.84.1 RPC
  runtime plus a Main-owned read-only session catalog.
- The current worktree already contains an official `get_fork_messages` ->
  `fork { entryId }` flow launched from the sidebar.
- Pi 0.84.1 only forks from a historical user-message `entryId`. The current
  rendered `Turn` model uses synthetic UI identifiers and does not preserve
  that official entry identifier, so relocating the action also requires an
  authoritative message-to-entry mapping.
- Pi 0.84.1 RPC has no delete-session command. Pi's official interactive
  session selector confirms deletion, tries the operating-system trash first,
  and falls back to unlinking the session file when trash is unavailable.
- Session paths stay Main-owned. Any delete command must resolve an opaque
  catalog selection token, revalidate its scope and canonical file, and never
  expose a filesystem path to the renderer.
- Existing copy actions use Electron renderer clipboard APIs and the current
  destructive confirmation pattern is a Radix alert dialog.
- The supplied Codex reference confirms that actions belong to each completed
  assistant response rather than once at the bottom of the conversation. They
  remain visually subordinate inline icons below the complete response body.
- Product code must not restore the removed legacy Agent/session stack.

## Resolved Product Decisions

- Every completed assistant response owns one action row after all of its
  rendered content. Copy includes its assistant Markdown only. Fork targets
  that response's preceding official user-message entry.
- Active sessions are deletable. Confirmation stops the matching Pi runtime,
  then deletion follows Pi's trash-first/unlink-fallback behavior and clears
  the selected session without changing the selected project.
- No feedback buttons, bulk deletion, undo UI, session-entry deletion, or web
  implementation are included.
