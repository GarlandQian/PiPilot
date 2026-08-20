# Implement Composer Images And Workspace Context

## Goal

Make the Composer paperclip and `@` controls fully functional without a plugin:
send selected images through official Pi RPC and add searchable workspace file
or directory references that the official Agent can inspect with its tools.

## Confirmed Facts

- Official `prompt`, `steer`, and `follow_up` commands accept `images` as base64
  `ImageContent` with MIME type.
- Official JSONL RPC does not define arbitrary binary attachments or a
  structured workspace-context field, and TUI `@file` expansion is not an RPC
  contract.
- The current paperclip has no action and the `@` button inserts a hard-coded
  `README.md` chip in `src/components/chat/Composer.tsx`.
- PiPilot already has bounded canonical workspace directory listing and file
  preview services that can be extended with path-name search.

## Requirements

### Image Attachments

- The paperclip opens the Electron renderer's native file chooser for supported
  images with multiple selection. Reuse the same ingestion path for pasted or
  dropped image files when the Composer receives them.
- Guarantee PNG and JPEG; at implementation time inspect current Pi image
  processing and include additional browser MIME types only when the selected
  official version supports them.
- Validate MIME/count/decoded bytes before base64 conversion. Initial bounds are
  8 images, 10 MiB per image, and 32 MiB total; show a localized per-file error
  and never send a partial silent subset.
- Show stable thumbnail/name/size chips with remove controls. Revoke preview
  object URLs when removed, sent, session/workspace changes, or component
  disposal.
- Convert accepted images to exact official `{ type: "image", data, mimeType }`
  objects at submission. Do not persist raw image bytes, file paths, or base64 in
  PiPilot settings/workspace state.
- Pass images unchanged through the renderer's official action: idle uses
  `prompt`, a running primary/keyboard submission defaults to `follow_up`, and
  an explicit one-shot Steer uses `steer`. If the current model cannot accept
  images or Pi rejects preflight, preserve the draft/attachments and show the
  official error.

### Workspace Context

- The `@` control opens a keyboard-accessible searchable picker for files and
  directories under the active workspace. Search canonical relative path/name,
  not file contents, with type icon, path, and file/directory distinction.
- Add a bounded Main workspace path-search contract that reuses canonical
  containment and generated-directory exclusions, does not apply the removed
  sensitive-file policy, and returns at most 100 ranked results. A missing
  workspace disables the picker with a clear state.
- Selecting a result creates one deduplicated removable context chip. Directory
  references end with `/` in presentation; files retain canonical relative
  paths. Workspace/session replacement clears stale references.
- Context selection does not read/inline contents or add a private RPC field.
  At submit time append one deterministic human-readable `Referenced workspace
  paths` block to the user message, with canonical paths, so official Pi tools
  can inspect them if relevant.
- Preserve the user's typed text exactly before the appended block. Paths cannot
  contain newline/backtick injection because they come from the canonical path
  schema; the transcript may show the same official message sent to Pi.

### Submission UX

- Allow submission when any of text, image, or context is present. Send one
  official command with one correlated response; prevent duplicate clicks while
  preflight is pending.
- Preserve the running-input contract owned by the renderer task: Composer stays
  editable while streaming, Queue remains the default for every submit, Steer is
  one-shot, and Stop is separate. A queued or steered submission captures text,
  images, and context together.
- Clear text/images/context only after official command acceptance. On chooser,
  conversion, path-search, disconnected, timeout, or Pi error, preserve the
  current draft and valid selections.
- Keep model selection, stop, keyboard submission, extension
  `set_editor_text`, responsive layout, and focus behavior. Extension editor
  updates change text only and never silently discard selections.
- Core image/context behavior requires only local Pi, not `pi-mcp-adapter` or any
  other plugin.

## Acceptance Criteria

- [ ] Paperclip selection, paste, and drop create removable previews for valid
      PNG/JPEG files; duplicate/unsupported/oversized/over-count input produces
      a visible error and no silent partial send.
- [ ] Successful idle Prompt, running default Queue, and explicit one-shot Steer
      submissions send the exact selected base64/MIME image array through
      `prompt`, `follow_up`, and `steer` respectively.
- [ ] Image-only, context-only, and combined text/image/context submissions are
      accepted by the deterministic fixture and clear only after response
      acceptance.
- [ ] A failed/disconnected/timed-out/model-incompatible submission retains the
      typed text, image previews, context chips, and keyboard focus.
- [ ] `@` search returns bounded ranked canonical workspace files/directories,
      supports keyboard selection, deduplicates chips, and excludes paths outside
      the active workspace while not hiding ordinary `.env`/auth-named files by
      the removed policy.
- [ ] The outgoing message preserves user text and contains exactly one stable
      referenced-path block; no file content or non-official context field is
      injected into RPC.
- [ ] Workspace/session change clears stale path references and image object URLs
      so a later session cannot send prior selections accidentally.
- [ ] No image bytes are written to app settings/workspace persistence and all
      preview URLs are revoked.
- [ ] The workflow works with only local Pi and no optional plugin.
- [ ] Focused path-search/submission tests, typecheck, Electron chooser/paste/
      keyboard workflow, and build pass.

## Out Of Scope

- Arbitrary binary/text attachments, external files as context, file-content
  search, automatic recursive content injection, or embedding a repository
  snapshot into the prompt.
- Upload persistence, an attachment library, image editing/compression UI, or
  cloud storage.
- Reimplementing Pi TUI `@file` parsing or adding a private Agent context
  protocol.
- MCP configuration/execution or package installation.

## Dependencies And Ownership

This task follows the local RPC renderer's Prompt/Queue/Steer/Stop contract and
official image envelopes, and shares WorkspaceContentService with the read-only
Diff/file-tree tasks. It owns Composer attachment/context state and UI, image
ingestion/official payload mapping, workspace path search contract/service/IPC/
preload flow, prompt block formatting, locales, and focused tests. It is cross-
layer and requires `design.md` plus `implement.md`.
