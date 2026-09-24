# PiPilot

**English** | [简体中文](README.zh-CN.md)

PiPilot is an Electron desktop client for the official [Pi coding
agent](https://github.com/earendil-works/pi). It runs the pinned Pi SDK (0.85.1) in isolated
Electron utility processes and adds a desktop workspace for conversations, projects, files,
terminals, models, and Pi extensions.

Pi continues to own its sessions, configuration, and resources. PiPilot provides the desktop
experience and does not create a parallel agent runtime or migrate Pi data into a private format.

**Source version:** 0.0.7 · [Download releases](https://github.com/GarlandQian/PiPilot/releases)

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

## Features

- **Projects and conversations** — choose project folders explicitly or start a projectless chat;
  browse, search, organize, and manage Pi sessions.
- **Conversation workspace** — follow messages and tool activity in one timeline; queue, edit, or
  steer follow-up messages; use Commands, Skills, file references, model selection, and Thinking
  controls.
- **Project tools** — inspect files and diffs, search command output, review subagent activity, and
  use per-project terminal tabs.
- **Pi configuration** — manage models and providers, Packages, Resources, Extensions, Skills,
  Prompts, Themes, and global or project MCP settings.
- **Desktop preferences** — use light or dark appearance, English or Simplified Chinese, keyboard
  navigation, and configurable terminal typography.
- **External Control** — optionally expose a local MCP interface for conversation status and prompt
  control. It is disabled by default; see [External Control](#external-control).

PiPilot is an Electron desktop application; it does not provide a web version.

## Download and installation

Download a build from [GitHub Releases](https://github.com/GarlandQian/PiPilot/releases).

| Platform | Architecture | Formats |
| --- | --- | --- |
| macOS | arm64, x64 | DMG, ZIP |
| Windows | x64 | NSIS |
| Linux | x64 | AppImage, DEB |

Installers are currently unsigned. macOS builds are not notarized, so macOS may ask you to approve
the app before opening it. Windows may show a SmartScreen or unknown-publisher warning. PiPilot does
not silently download or install updates; macOS uses manual downloads, and native Windows/Linux
updates remain disabled while their update path is being validated.

## Development

### Requirements

- macOS, Windows, or Linux
- Node.js 24.18.0
- pnpm 12.3.4 (declared in `package.json`)

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
checks exercise the unpacked app, not the complete DMG, NSIS, or DEB installation flow.

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

PiPilot does not scan the disk for projects or treat the home directory as a project. A project is
selected with the native folder picker. Projectless chats use an application-private working
directory while sessions remain in Pi's official session storage.

The default Pi Agent directory is `~/.pi/agent`. Set `PI_CODING_AGENT_DIR` to use another directory;
the Pi runtime, package manager, model editor, and global MCP editor use that same location.

| Path | Purpose |
| --- | --- |
| `~/.pi/agent/settings.json` | Pi global settings and default model |
| `~/.pi/agent/models.json` | Custom providers and models |
| `~/.pi/agent/auth.json` | Pi SDK authentication |
| `~/.pi/agent/mcp.json` | Global MCP configuration |
| `~/.pi/agent/sessions/` | Official Pi sessions |
| `<project>/.pi/settings.json` | Project Pi settings |
| `<project>/.mcp.json` | Project MCP configuration |

MCP configuration follows PiPilot's extension convention; Pi core does not define an MCP
configuration format. Appearance, navigation, and window preferences are stored separately in
Electron's application data directory. Do not commit API keys, tokens, or real session content.

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
