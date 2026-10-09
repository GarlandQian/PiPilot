<div align="center">

<img src="build/icon.png" alt="PiPilot" width="96" />

# PiPilot

### Pi 编程代理的桌面工作区

在一个窗口中处理对话、代码、终端和 Pi 工具。

macOS · Windows · Linux

[![Release](https://img.shields.io/github/v/release/GarlandQian/PiPilot)](https://github.com/GarlandQian/PiPilot/releases/latest)
[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

[下载](https://github.com/GarlandQian/PiPilot/releases/latest) · [使用指南](docs/usage.zh-CN.md) · [更新日志](CHANGELOG.md) · [English](README.md)

</div>

PiPilot 为官方 [Pi coding agent](https://github.com/earendil-works/pi) 提供桌面工作区。选择项目或发起普通聊天，查看工具执行、审阅代码变更，并在应用中管理模型和扩展。

Pi 继续管理自己的会话、配置与资源。PiPilot 使用官方 SDK 和数据格式，你的 Pi 配置也能继续用于桌面应用之外的工作流。

## 可以做什么

| 工作区 | 功能 |
| --- | --- |
| 项目与对话 | 项目聊天、普通聊天、消息排队与插话、本机草稿、搜索、置顶和归档 |
| 代码与终端 | 文件浏览、Diff 审阅与评论、带来源的引用、项目终端标签页、外部编辑器 |
| 计划与目标 | 集成 Plan Mode、Goal 和 Subagents，在对话旁查看状态和活动 |
| 项目工作流 | 创建本地 Git worktree，保存并主动运行安装、测试和开发动作 |
| Pi 配置 | 供应商预设、模型发现与信息补全、Thinking、Packages、Skills、Prompts 和 Themes |
| MCP 服务器 | 常用模板、从其他应用导入、表单／JSON 编辑，以及全局或项目配置 |
| 对话流转 | Markdown 导入与导出，支持随文档保存图片附件 |
| 桌面工具 | 深浅主题、Liquid Glass 着色、通知、定时 Prompt 和可选的本地 MCP 控制 |

操作方式及使用边界详见[使用指南](docs/usage.zh-CN.md)。PiPilot 是桌面应用，不提供 Web 版本。

## 下载与安装

从[最新 Release](https://github.com/GarlandQian/PiPilot/releases/latest)选择适合系统和处理器的安装包。

| 系统 | 架构 | 格式 | 如何选择 |
| --- | --- | --- | --- |
| macOS | Apple Silicon（arm64） | DMG、ZIP | 常规安装选 DMG；ZIP 提供应用包 |
| macOS | Intel（x64） | DMG、ZIP | Intel Mac 使用 |
| Windows | x64 | 安装版 EXE、便携 EXE、便携 ZIP | 日常安装选 Setup；需要携带应用目录选便携版 |
| Linux | x64 | AppImage、DEB、RPM | 独立运行选 AppImage；DEB/RPM 按发行版包管理器选择 |
| Linux | ARM64 | AppImage、DEB、RPM | ARM64 设备，格式选择相同 |

README 描述当前源码；某个已发布版本具体提供哪些安装包，以其 Release 附件为准。功能对应版本见[更新日志](CHANGELOG.md)。

文件名包含版本、系统和架构，例如 `PiPilot-0.5.0-windows-x64-setup.exe`。便携版以 `-portable.exe`、`-portable.zip` 区分。Linux 格式可能使用 `x86_64` / `amd64` 表示 x64、`aarch64` 表示 ARM64。各平台均附带 SHA-256 校验清单。

macOS 使用 ad-hoc 签名，尚未配置 Developer ID 签名和公证；Windows 安装包未签名。系统可能要求批准打开应用，或显示未知发布者提示。

### 开始第一次对话

1. 安装并打开 PiPilot。安装包已包含 Pi Runtime，无需另装 Node.js 或 Pi。
2. 在设置中配置 Provider 和模型，按该 Provider 的方式完成认证。
3. 添加项目目录或新建普通聊天，选择模型后发送需求。

打开项目对话时会随项目资源加载 MCP 配置，请只添加可信项目。外部 stdio MCP 服务器可能仍需单独安装 `node`、`npx` 或 `uvx` 等运行环境。

### 检查与安装更新

所有发行类型均在启动后 15 秒、运行期间每 12 小时检查稳定版更新，也可随时点击 **设置 → 关于 → 检查更新**。

| 发行类型 | 更新方式 |
| --- | --- |
| Windows 安装版 / Linux AppImage | 点击下载，再确认重启安装；重启前检查运行中的任务和未保存配置 |
| macOS / Linux DEB、RPM | 打开新版 Release，下载对应安装包后手动安装 |
| Windows 便携版 | 退出应用，替换程序文件，保留旁边的 `data/` 文件夹 |

仍使用旧版手动更新方式的 Windows 安装版，需要先手动安装一次新版。自动更新要求版本号递增；覆盖同一版本的 Release 附件不会触发更新。

### Windows 便携版

应用数据保存在程序旁的 `data/`，Pi 默认目录为 `data/agent/`。请放在可写目录中，升级时保留 `data/`。完整移动文件夹即可携带默认数据；如果已另选外部 Pi 目录，该目录仍使用原来配置的路径。

便携 EXE 会临时解压运行。需要固定的 `pipilot-mcp` 启动器路径时，请使用安装版或便携 ZIP。

## 配置与数据

Pi 默认目录为 `~/.pi/agent`。可在 **设置 → 通用 → Pi 配置目录** 选择其他文件夹，退出并重新打开后生效。切换目录不会迁移、覆盖或删除旧文件。

目录优先级依次为：设置中选择的目录 → `PI_CODING_AGENT_DIR` → 便携版 `data/agent/` → `~/.pi/agent`。模型、认证、Packages、全局 MCP 配置和会话共用该目录；项目 `.pi/` 文件仍在项目中，PiPilot 界面设置独立保存。

文件位置和默认包行为见[配置与数据说明](docs/usage.zh-CN.md#pi-配置与数据)，可选的本地 MCP 控制接口见 [External Control](docs/usage.zh-CN.md#external-control)。

## 常见问题

- **Windows 的 npm 与对话启动。** 安装版和便携版均附带 Node.js、npm、npx，供对话、扩展包和 MCP 使用。从桌面图标启动也不依赖 fnm 的终端环境，无需修改系统 PATH。升级后请完全退出旧版（包括托盘进程）再打开。
- **更换安装目录后，MCP 启动器显示不可用。** 已确认旧 Windows 安装被移除时，可在 External Control 中点击「修复」。旧安装仍存在或记录无法验证时，会显示具体冲突原因，不会覆盖另一份安装。便携 EXE 如需稳定启动器，请改用安装版或便携 ZIP。
- **外部 MCP 命令找不到。** Windows 提供内置 node、npm、npx；macOS／Linux 桌面启动时会尝试读取登录 Shell 环境。uvx、grok-search-rs 等其他命令仍需安装，并能从应用 PATH 找到，或填写可执行文件绝对路径。npx 首次下载服务器包需要网络；缺少浏览器、凭据等会显示对应服务器错误。

提交 [Issue](https://github.com/GarlandQian/PiPilot/issues) 时，请附版本、系统、架构、安装包类型和错误文本，并移除凭据与私人会话内容。

## 开发

使用 **Node.js 24.18.0** 和 **pnpm 12.8.1**。

~~~sh
git clone https://github.com/GarlandQian/PiPilot.git
cd PiPilot
pnpm install --frozen-lockfile
pnpm dev
~~~

| 命令 | 用途 |
| --- | --- |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm test:unit` | 单元与契约测试 |
| `pnpm test:electron` | 完整 Electron 测试，包含集成场景 |
| `pnpm build` | 类型检查与构建 |
| `pnpm package:dir` / `pnpm test:packaged` | 构建未打包应用目录 / 验证打包后的 Runtime |
| `pnpm package:mac` | macOS arm64、x64 的 DMG/ZIP |
| `pnpm package:win` | Windows x64 安装版和便携 EXE/ZIP |
| `pnpm package:linux` | Linux x64 AppImage/DEB/RPM |

请在对应操作系统中运行原生打包。发布流程还会构建 Linux ARM64，在一次性 runner 上验证安装与更新路径，再汇总经过校验的产物。

应用由 Electron Main、sandbox preload 和 React 组成，Renderer 通过共享 Zod 契约及白名单 IPC 访问 Pi 与文件系统。主要代码位于 `src/main/`、`src/preload/`、`src/shared/`、`src/components/` 和 `tests/`。

## 文档与发布

- [使用指南](docs/usage.zh-CN.md) · [English guide](docs/usage.md)
- [更新日志](CHANGELOG.md)：维护每个版本的 Release 变更说明
- [GitHub Releases](https://github.com/GarlandQian/PiPilot/releases)：已发布安装包与校验清单

贡献时使用冻结的 lockfile；请勿提交个人配置、密钥、构建产物或测试报告。

## 许可证

[MIT](LICENSE)
