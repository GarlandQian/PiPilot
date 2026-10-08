# PiPilot

**English** | [简体中文](README.zh-CN.md)

PiPilot is an Electron desktop client for the official [Pi coding
agent](https://github.com/earendil-works/pi). It runs the pinned Pi SDK (0.99.1) in isolated
Electron utility processes and adds a desktop workspace for conversations, projects, files,
terminals, models, and Pi extensions.

Pi continues to own its sessions, configuration, and resources. PiPilot provides the desktop
experience and does not create a parallel agent runtime or migrate Pi data into a private format.

**Source version:** 0.3.5 · [Download releases](https://github.com/GarlandQian/PiPilot/releases)

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

## Features

- **Projects and conversations** — choose project folders explicitly or start a projectless chat;
  browse, search, organize, and manage Pi sessions. Filter by activity, sort by recent or name, and
  show archived tasks from the sidebar's View Options menu.
- **Conversation workspace** — follow messages and tool activity in one timeline. While Pi
  replies, queue or steer a message (⌘⇧↩ picks the other); reorder queued messages, take one back
  into the input to edit, or steer it. Stopping a reply puts unsent messages back into the input.
  Use Commands, Skills, file references, model selection, and Thinking controls.
- **Local drafts** — restore unsent text, references, and images after restarting. Drafts stay in
  PiPilot's local application storage; sending or clearing input removes its saved draft, and
  deleting a conversation removes its draft. Shutdown waits for pending draft writes.
- **Conversation overview** — the inspector's Overview tab keeps a short summary, status, and
  up to three next-step drafts. Plan and Goal each get one status row; Plan links to its card in
  the conversation. Only relevant outputs, sources, used Skills/MCP, and web links appear.
- **Markdown export** — export the current conversation branch, a response round, or a single
  message. Tool logs are optional; images are saved beside the Markdown file. System messages
  and hidden thinking are excluded.
- **Markdown import** — preview a document and create a separate project or general conversation.
  Current PiPilot exports restore user/assistant history; ordinary or unrecognized Markdown becomes
  background content. Importing never submits a prompt or replays old tools or plan approvals.
- **Project tools** — inspect files and diffs, search command output, review subagent activity, and
  use per-project terminal tabs.
- **References and review** — quote selected message, file or command text with its source snapshot;
  comment on selected diff lines, then collect the comments into your draft before sending.
- **Conversation search** — search current message content with Cmd/Ctrl+F, or all registered
  projects with Cmd/Ctrl+Shift+F. Results jump to the matching response; saved sessions use their
  current branch. Very large or unavailable sessions are reported as omitted, not silently indexed.
- **Side questions** — ask about selected text in an independent, saved Pi conversation in the
  inspector. Closing its view keeps it running and preserves its official session. Use Stop to
  request cancellation; completed, cancelled and failed turns have distinct states.
- **Working copies and project actions** — create local Git worktrees from a project's menu;
  save setup/test/dev commands with platform overrides, run them explicitly, and inspect logs.
  Creation can also run a saved setup action that you select and confirm. Archiving moves the
  complete worktree into local storage, retaining staged, unstaged, untracked and ignored files
  without freeing disk space. Switch to another project and stop its terminals and actions first;
  active, queued, interactive or leased conversations also prevent archiving. Restore returns to
  the original path and refuses to overwrite an occupied location. Pi session files stay in their
  official location. No commits, merges or pushes run automatically.
- **Pi configuration** — manage models and providers, Packages, Resources, Extensions, Skills,
  Prompts, Themes, and global or project MCP settings.
- **Desktop preferences** — choose system, light, or dark appearance; tune Liquid Glass surfaces
  from clear to tinted; and configure language, keyboard navigation, and terminal typography.
- **External Control** — optionally expose a local MCP interface for conversation status and prompt
  control. It is disabled by default; see [External Control](#external-control).

PiPilot is an Electron desktop application; it does not provide a web version.

Background conversations keep running while you switch projects. Idle runtime caches have a
global budget, and empty project Hosts retire after a grace period; executing, queued, interactive,
or leased work is protected. Reclaiming a cache never removes a conversation from the sidebar.

## Desktop preferences

In **Settings > Appearance**, choose System, Light, or Dark and use the Liquid Glass slider to
adjust glass-surface tint from Clear to Tinted. Existing appearance settings are retained when the
new preference is added. In the session sidebar, the always-visible filters show all, running, or
attention-needed sessions; **View Options** changes sort order or toggles archived tasks.

In **Settings > General**, completion sound is enabled by default and can be turned off independently
of desktop notifications. A completed conversation sounds once only when you are not viewing it;
intermediate activity, retries, cancellations, and tool completions stay quiet.

## Plans, goals, and conversation overview

The Plan Mode plugin owns planning, revision, saving, and the handoff to implementation. Choose
**Plan** from the composer's **+** menu (⌘⇧P), write the request, and send it; this runs
`/plan <request>`. The plan appears as a card in the conversation, where you start, revise, save,
export, or discard it, and the composer offers **Start implementation** while it waits for you.
**Start implementation** hands the plan to the agent; it does not track completed steps or
guarantee continued work until every step is done. Use the Goal plugin (**Goal** in the **+** menu,
⌘⇧G, or `/goal <objective>`) for continued execution toward a goal. Its status and
pause/resume/clear controls appear above the composer and in Overview. Subagents provides delegation, with activity shown in the
conversation and subagent inspector. PiPilot uses these plugins' commands and state rather than
maintaining a second plan approval or execution engine.

The current upstream saved-plan `/plan implement` path does not enforce mutual exclusion with
Goal. PiPilot's GUI withholds Plan implementation, revision, and finalization actions while a Goal
is unfinished, including while paused. Raw slash commands retain the plugin's behavior; finish or
clear the existing Goal before using them to start plan implementation.

PiPilot's built-in task tool maintains only the conversation summary, actual blockers, and up to
three next-step drafts. This metadata is stored as custom entries in the official Pi session tree.
Historical built-in plan records remain in the session; Overview reuses their metadata but does
not reactivate their approvals or execution state. Older conversations have no generated summary
until the assistant updates it. A suggested next step appends to the existing draft and preserves
references and images; it never sends automatically. File entries link to their conversation
records, and a mentioned web URL is not a claim that the page was visited.

Use a conversation's sidebar **… > Export Markdown…** menu, beside its pin/archive actions.
Exporting an unopened or background conversation does not switch the current conversation or start
its agent. Message actions still export individual messages or response rounds. Keep the generated
image folder beside the Markdown file; workspace output links are retained without copying their files.

To import, use a project's **… > Import conversation from Markdown…**, or the menu beside the sidebar's
new-conversation button. Preview the file, edit its name, choose a project or general chat, then confirm.
Current PiPilot exports include versioned role metadata; edited, old, or unrecognized files fall back
to background documents rather than guessing roles from headings. Missing/unsupported images are
reported. Only supported images in the adjacent export attachment folder are read, never remote or
arbitrary linked files. File reads are bounded to 16 MiB of Markdown and 32 MiB including attachments;
the resulting conversation must also fit a 6 MiB transfer budget (including encoded image data).
Oversized imports are rejected during preview, before creating a conversation.
The new conversation has its own identity and waits for your next message; old tools, pending messages,
and plan approvals are not restored. Existing conversations remain unchanged.

## Download and installation

Download a build from [GitHub Releases](https://github.com/GarlandQian/PiPilot/releases).

| Platform | Architecture | Formats |
| --- | --- | --- |
| macOS | arm64, x64 | DMG, ZIP |
| Windows | x64 | NSIS |
| Linux | x64 | AppImage, DEB |

Installers are currently unsigned. macOS builds are not notarized, so macOS may ask you to approve
the app before opening it. Windows may show a SmartScreen or unknown-publisher warning.

Installer filenames include the version, system (`macos`, `windows`, or `linux`), and architecture,
for example `PiPilot-0.3.5-macos-arm64.dmg`. Linux targets may use `x86_64` or `amd64` for x64.
All supported desktop packages check for stable updates 15 seconds after startup and every 12 hours
while running. You can also select **Settings → About → Check for updates**.

Windows setup lets you choose the installation directory. Windows NSIS and Linux AppImage builds
automatically check for newer stable releases; you choose when to download and confirm when to
restart and install. Active work and unsaved configuration are checked before restart. Windows
updates reuse the existing installation directory and preserve Pi settings and sessions. Downloads
are verified against the official updater metadata; Windows packages remain unsigned.

macOS and Linux DEB builds automatically check for updates and offer manual downloads and installation.
Older Windows builds with manual updates need one
manual installation to enable the in-app update flow. Updates require a higher version number;
replacing assets under the same release version does not trigger an update.

## Development

### Requirements

- macOS, Windows, or Linux
- Node.js 24.18.0
- pnpm 12.8.1 (declared in `package.json`)

Packaged users do not need Node.js, pnpm, or a separate Pi executable. Development uses the Pi SDK
version pinned in `package.json` and `pnpm-lock.yaml`.

### Run locally

~~~sh
git clone https://github.com/GarlandQian/PiPilot.git
cd PiPilot
pnpm install --frozen-lockfile
pnpm dev
~~~

### Common commands

~~~sh
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm build
~~~

The Electron suite runs through Playwright. CI runs unit contracts on macOS, Windows, and Linux and
the complete Electron suite on macOS. Provider contract cases use the installed Pi SDK with local
HTTP/SSE fixtures; they cover OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and
Google Generative AI without real provider accounts or personal Pi data.

`tests/electron/renderer-performance.electron.spec.ts` measures input responsiveness, frame gaps,
and conversation switching with 1,000 historical replies and a 32 KB streaming Markdown response.
It saves JSON metrics and a Chromium CPU profile, and verifies tables, late reference definitions,
complete copying, and navigation. Timing is reported without machine-dependent pass thresholds.

### Package locally

~~~sh
# Build an unpacked app for this platform
pnpm package:dir
pnpm test:packaged

# Build native installers
pnpm package:mac
pnpm package:win
pnpm package:linux
~~~

macOS packaging produces arm64 and x64 builds. To run packaged smoke checks for each architecture
explicitly:

~~~sh
PIPILOT_PACKAGED_ARCH=arm64 pnpm test:packaged
PIPILOT_PACKAGED_ARCH=x64 pnpm test:packaged
~~~

The smoke checks verify the selected app architecture and fail if that build is missing; they do not
substitute the other architecture. Intel builds on Apple Silicon require Rosetta. Packaged smoke
checks normally exercise the unpacked app. The release workflow also runs guarded installation
canaries on disposable runners: Windows installs and updates NSIS; Linux launches a real AppImage,
updates an isolated version 0.0.0 fixture to the exact candidate, observes the automatic restart,
and verifies preserved settings, Pi configuration, projects and sessions with image content. It
also installs the candidate DEB with dpkg, launches its registered executable, checks its manual
update policy, and uninstalls it. Both Linux checks gate candidate upload and retain logs and
screenshots. They reject existing installations and isolate user data and caches; they are skipped
outside their prepared CI environment. The full macOS DMG installation flow is not covered.

## Architecture

The app is split into Electron Main, a sandboxed preload, and a React renderer. The renderer has no
direct access to Node.js, the filesystem, or Pi. Cross-process data passes through shared Zod
contracts and allowlisted IPC.

| Path | Contents |
| --- | --- |
| `src/main/` | Pi runtime, filesystem, terminal, configuration, and Electron Main services |
| `src/preload/` | Sandboxed preload and IPC facade |
| `src/shared/` | Cross-process contracts and domain types |
| `src/renderer/` | Renderer adapters and pure logic |
| `src/components/`, `src/store/` | React UI and state owners |
| `tests/` | Unit, Electron, integration, and packaged smoke tests |

## Pi configuration and data

PiPilot does not scan the disk for projects or treat the home directory as a project. Add an existing
project with the native folder picker, or create a managed local Git working copy from a project's
menu. Projectless chats use an application-private working directory while sessions remain in Pi's
official session storage.

The default Pi Agent directory is `~/.pi/agent`. Set `PI_CODING_AGENT_DIR` to use another directory;
the Pi runtime, package manager, model editor, and global MCP editor use that same location.

PiPilot automatically installs missing Plan Mode, Subagents, and Goal packages into that shared
global Pi directory. The initial versions supported by this release are `@narumitw/pi-plan-mode@0.58.3`,
`pi-subagents@0.74.0`, and `@narumitw/pi-goal@0.54.8`. These are regular Pi packages, available to Pi CLI
sessions using the same Agent directory; they are not private copies bundled into each project.
Existing installations and configured sources, versions, and resource filters are preserved.
Removing a default package opts out of automatic reinstallation, including after a restart or app
upgrade. Installation failures remain visible in **Settings > Integrations** and require an explicit
retry; PiPilot does not repeatedly retry or silently replace an existing version. You can manage or
reinstall each package there yourself.

| Path | Purpose |
| --- | --- |
| `~/.pi/agent/settings.json` | Pi global settings and default model |
| `~/.pi/agent/models.json` | Custom providers and models |
| `~/.pi/agent/auth.json` | Pi SDK authentication |
| `~/.pi/agent/mcp.json` | Global MCP configuration |
| `~/.pi/agent/sessions/` | Official Pi sessions |
| `<project>/.pi/settings.json` | Project Pi settings |
| `<project>/.pi/mcp.json` | Project MCP configuration |

MCP connections use Pi's native support and standard JSON configuration. The built-in runtime
supports stdio and Streamable HTTP servers; no MCP adapter package is required or automatically
installed. Existing user-installed extensions remain under your control. Pi gives an enabled
`pi-mcp-adapter` precedence over its native integration. After checking the native configuration,
remove the old adapter from **Settings > Integrations > Packages** and reload the runtime to use
native MCP; PiPilot does not uninstall personal extensions automatically.

The bundled Pi runtime does not require a separate Node.js installation. A stdio MCP server may
still require its own runtime, such as `node`, `npx`, or `uvx`. That command must be available to
the application process, or configured with an absolute executable path. On macOS, an application
opened from Finder may have a different PATH from your terminal. Project MCP configuration runs
with the project resources when you open a conversation, so only add projects you trust.

The MCP editor can import the old project `.mcp.json` into a draft for `.pi/mcp.json`, translating
`disabled` to `enabled`. Import does not write files until you save and keeps the original file.
Unsupported socket or SSE-only configurations show validation errors instead of being silently
discarded. Appearance, navigation, and window preferences are stored separately in Electron's
application data directory. Do not commit API keys, tokens, or real session content.

## Scheduled tasks

**Settings > Scheduled tasks** runs saved prompts in an existing, saved Pi conversation. Choose a
one-time date, daily wall time with an IANA time zone, or an interval. PiPilot must be running;
there is no operating-system background daemon. Tasks run without changing the selected
conversation and work independently of the External Control switch.

Missed occurrences default to one catch-up run; the alternative skips occurrences more than a
minute late. Overlapping runs are skipped. Daily daylight-saving gaps skip that day and repeated
wall times run once. Pause affects future runs. A task can be edited or deleted after its current
run ends; deleting keeps the conversation and retained history. Run now is an explicit additional
attempt and does not replace its schedule.

The private `scheduled-tasks/ledger.json` in Electron user data holds up to 100 tasks and the latest
500 attempts. Dispatch is reserved and synced to disk before sending. After a restart, an attempt
without a confirmed terminal outcome is marked **Outcome unknown** and its task is paused: it is
never automatically replayed or reported as complete. Inspect that conversation before resuming.
Deleted/replaced targets and requests for interactive input also pause the task; PiPilot never
approves those requests automatically. Completion/failure alerts follow the desktop-notification
preference. A malformed or unwritable ledger stops scheduling rather than discarding its records.

## External Control

External Control is an optional inbound MCP interface, separate from Pi's outbound MCP settings.
Enable it in **Settings > Integrations**. It is off by default.

When enabled, PiPilot can install or repair the `pipilot-mcp` launcher and show this client
configuration:

~~~json
{
  "mcpServers": {
    "pipilot": {
      "command": "pipilot-mcp",
      "args": []
    }
  }
}
~~~

The MCP client starts a stdio process that connects to the running app over an authenticated,
current-user-only Unix socket (macOS/Linux) or named pipe (Windows). PiPilot does not open a network
listener. The interface supports bounded conversation listing and status, prompt and abort
operations, operation receipts, and waits. It does not expose transcript history, credentials, or
filesystem session paths.

Launcher management is explicit. PiPilot changes only its own launcher files and the current user's
PATH registration; it does not edit Codex, Claude Code, Pi, shell profiles, or project MCP files.

## Releases and contributing

A stable release tag starts the release verification workflow. Platform builds are checked and
packaged smoke tests run before the GitHub Release is published. Build targets are defined in
`electron-builder.yml`; packaged checks are in `tests/packaged/`.

Use pnpm with the frozen lockfile when contributing. Read the relevant implementation and tests
before making changes, and do not commit personal configuration, credentials, build output, or
generated test reports.

## License

[MIT](LICENSE)
