<div align="center">

<img src="build/icon.png" alt="PiPilot" width="96" />

# PiPilot

### A desktop workspace for the Pi coding agent

Conversations, code, terminals, and Pi tools — together on your desktop.

macOS · Windows · Linux

[![Release](https://img.shields.io/github/v/release/GarlandQian/PiPilot)](https://github.com/GarlandQian/PiPilot/releases/latest)
[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

[Download](https://github.com/GarlandQian/PiPilot/releases/latest) · [User guide](docs/usage.md) · [What's new](CHANGELOG.md) · [简体中文](README.zh-CN.md)

</div>

PiPilot brings the official [Pi coding agent](https://github.com/earendil-works/pi) into a desktop workspace. Work with projects or start a general chat, follow tools as they run, review changes, and manage models and extensions from one app.

Pi keeps its own sessions, configuration, and resources. PiPilot uses the official SDK and its data formats, so your Pi configuration remains useful outside the desktop app.

## What you can do

| Workspace | What it offers |
| --- | --- |
| Conversations | Project and general chats, queue or steer messages, persistent drafts, search, pinning, and archiving |
| Code and terminals | File browsing, diffs and review comments, source-linked quotes, project terminal tabs, and external editors |
| Plans and goals | Plan Mode, Goal, and Subagents integration with status and activity alongside your conversation |
| Project workflows | Local Git worktrees and saved setup, test, and development actions you choose when to run |
| Your Pi setup | Provider presets, model discovery and metadata, thinking controls, packages, skills, prompts, and themes |
| MCP servers | Templates, configuration import from other apps, form/JSON editing, and global or project scopes |
| Portable conversations | Markdown import and export, including adjacent image attachments |
| Desktop tools | Light/dark appearance, Liquid Glass tint, notifications, scheduled prompts, and optional local MCP control |

The [user guide](docs/usage.md) covers these workflows and their limits. PiPilot is a desktop application; there is no web version.

## Download and install

Choose a package from the [latest Release](https://github.com/GarlandQian/PiPilot/releases/latest).

| System | Architecture | Packages | Choose this for |
| --- | --- | --- | --- |
| macOS | Apple Silicon (arm64) | DMG, ZIP | DMG for normal installation; ZIP for the app bundle |
| macOS | Intel (x64) | DMG, ZIP | Intel Macs |
| Windows | x64 | Setup EXE, portable EXE, portable ZIP | Setup for installed use; portable editions for a folder you can move |
| Linux | x64 | AppImage, DEB, RPM | AppImage for a standalone app; DEB/RPM for the matching package manager |
| Linux | ARM64 | AppImage, DEB, RPM | ARM64 machines, with the same format choices |

This README describes the current source. The assets on each Release page are authoritative for that published version; see [version changes](CHANGELOG.md) for availability.

Filenames include version, system, and architecture, for example `PiPilot-0.7.0-windows-x64-setup.exe`. Windows portable files end in `-portable.exe` or `-portable.zip`. Linux may use `x86_64`/`amd64` for x64 and `aarch64` for ARM64. SHA-256 lists accompany each platform's downloads.

macOS builds are ad-hoc signed, without Developer ID signing or notarization. Windows builds are unsigned. The operating system may ask you to approve opening the app or show an unknown-publisher warning.

### First conversation

1. Install and open PiPilot. Packaged builds include the Pi runtime; a separate Node.js or Pi installation is not required.
2. Configure a provider and model in Settings, using that provider's authentication.
3. Add a project folder or start a general chat, choose a model, and send your request.

Project MCP configuration loads with project resources when you open a conversation. Add projects you trust. External stdio MCP servers may need their own `node`, `npx`, or `uvx` runtime.

### Updates

All editions check for stable updates 15 seconds after startup and every 12 hours while running. **Settings → About → Check for updates** is always available.

| Edition | How to update |
| --- | --- |
| Windows Setup / Linux AppImage | Choose Download, then confirm restart and installation; active work and unsaved settings are checked first |
| macOS / Linux DEB or RPM | Open the new Release, download the matching package, and install it manually |
| Windows portable | Quit, replace the application files, and preserve the adjacent `data/` folder |

Older Windows releases using manual updates need one manual installation to enable the in-app flow. Updates require a higher version; replacing files on an existing Release does not trigger an update.

### Windows portable

Portable editions keep application data beside the program in `data/`, with Pi data in `data/agent/` by default. Use a writable directory and preserve `data/` when upgrading. Moving the entire folder carries the default data with it; an explicitly selected external Pi directory stays at its configured location.

The portable EXE extracts the app to a temporary location. Use Setup or portable ZIP when you need a stable `pipilot-mcp` launcher path.

## Configuration and data

Pi defaults to `~/.pi/agent`. Select another folder in **Settings → General → Pi configuration directory**, then quit and reopen the app. Switching folders does not migrate or delete existing files.

Directory precedence is: saved selection → `PI_CODING_AGENT_DIR` → portable `data/agent/` → `~/.pi/agent`. Models, authentication, packages, global MCP configuration, and sessions share that directory. Project `.pi/` files stay with the project; PiPilot interface settings remain separate.

See [configuration and data](docs/usage.md#pi-configuration-and-data) for file locations and package behavior, and [External Control](docs/usage.md#external-control) for the optional local MCP interface.

## Troubleshooting

- **Windows npm and conversation startup.** Setup and portable editions include Node.js, npm, and npx for conversations, packages, and MCP servers. Desktop shortcuts do not require fnm shell initialization or changes to the system PATH. Fully quit the old version, including its tray process, before opening the upgrade.
- **MCP launcher unavailable after moving an installation.** If the recorded Windows installation has been removed, use **Repair** in External Control. Another existing installation or an unverifiable record is shown as a conflict rather than overwritten. Portable EXE users should use Setup or portable ZIP for a stable launcher.
- **An external MCP command is missing.** Windows includes node, npm, and npx; macOS/Linux desktop launches try the login shell's environment. Other commands such as uvx and grok-search-rs still need installation and an accessible PATH or an absolute executable path. The first npx package download needs network access; missing browsers or credentials remain server-specific errors.

For bugs, include the PiPilot version, operating system, architecture, package type, and error text in a [GitHub issue](https://github.com/GarlandQian/PiPilot/issues). Remove credentials and personal session content.

## Development

Use **Node.js 24.18.0** and **pnpm 12.10.1**.

~~~sh
git clone https://github.com/GarlandQian/PiPilot.git
cd PiPilot
pnpm install --frozen-lockfile
pnpm dev
~~~

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Check TypeScript |
| `pnpm test:unit` | Run unit and contract tests |
| `pnpm test:electron` | Run the full Electron suite, including integration scenarios |
| `pnpm build` | Typecheck and build |
| `pnpm package:dir` / `pnpm test:packaged` | Build an unpacked app / test the packaged runtime |
| `pnpm package:mac` | Build macOS arm64 and x64 DMG/ZIP |
| `pnpm package:win` | Build Windows x64 Setup and portable EXE/ZIP |
| `pnpm package:linux` | Build Linux x64 AppImage/DEB/RPM |

Run native package builds on the corresponding operating system. The release workflow additionally builds Linux ARM64, exercises installation/update paths on disposable runners, and assembles validated assets.

The app uses Electron Main, a sandboxed preload, and React. The renderer accesses Pi and the filesystem through shared Zod contracts and allowlisted IPC. Start in `src/main/`, `src/preload/`, `src/shared/`, `src/components/`, and `tests/`.

## Documentation and releases

- [User guide](docs/usage.md) · [中文使用指南](docs/usage.zh-CN.md)
- [Changelog](CHANGELOG.md) — source for version-specific Release highlights
- [GitHub Releases](https://github.com/GarlandQian/PiPilot/releases) — published packages and checksums

Contributions use the frozen lockfile. Keep personal configuration, secrets, build output, and generated reports out of commits.

## License

[MIT](LICENSE)
