# PiPilot

[English](README.md) | **简体中文**

PiPilot 是基于官方 [Pi coding agent](https://github.com/earendil-works/pi) 的 Electron 桌面客户端。它在隔离的 Electron utility process 中运行锁定版本的 Pi SDK 0.85.1，为对话、项目、文件、终端、模型和 Pi 扩展提供桌面工作区。

Pi 继续管理自己的 Session、配置和资源。PiPilot 负责桌面体验，不维护另一套 Agent Runtime，也不把 Pi 数据迁移到私有格式中。

**源码版本：**0.0.7 · [下载发布版本](https://github.com/GarlandQian/PiPilot/releases)

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

## 主要功能

- **项目与对话**：由用户明确选择项目目录，也可发起无项目聊天；浏览、搜索、整理和管理 Pi Session。
- **对话工作区**：在同一时间线查看消息与工具活动；排队、编辑或调整后续消息；使用 Commands、Skills、文件引用、模型选择和 Thinking 控制。
- **项目工具**：查看文件和 diff、搜索命令输出、检查子代理活动，并使用按项目组织的终端标签页。
- **Pi 配置**：管理模型与 Provider、Packages、Resources、Extensions、Skills、Prompts、Themes，以及全局或项目级 MCP 设置。
- **桌面偏好**：支持浅色和深色主题、英文和简体中文、键盘操作及可配置的终端字体。
- **External Control**：可选的本地 MCP 接口，用于查看对话状态和控制 Prompt。默认关闭，详见 [External Control](#external-control)。

PiPilot 是 Electron 桌面应用，不提供 Web 版本。

## 下载与安装

从 [GitHub Releases](https://github.com/GarlandQian/PiPilot/releases) 下载安装包。

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| macOS | arm64、x64 | DMG、ZIP |
| Windows | x64 | NSIS |
| Linux | x64 | AppImage、DEB |

当前安装包未签名，macOS 版本也未公证。macOS 可能要求用户先批准再打开应用；Windows 可能显示 SmartScreen 或未知发布者警告。PiPilot 不会静默下载或安装更新：macOS 采用手动下载；Windows/Linux 的原生更新仍在验证中，尚未启用。

## 开发

### 环境要求

- macOS、Windows 或 Linux
- Node.js 24.18.0
- pnpm 12.3.4（由 `package.json` 声明）

使用安装包时无需另行安装 Node.js、pnpm 或 Pi 可执行文件。开发环境使用 `package.json` 和 `pnpm-lock.yaml` 锁定的 Pi SDK 版本。

### 本地运行

~~~sh
git clone https://github.com/GarlandQian/PiPilot.git
cd PiPilot
pnpm install --frozen-lockfile
pnpm dev
~~~

### 常用命令

~~~sh
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm build
~~~

Electron 回归测试通过 Playwright 运行。CI 会在 macOS、Windows、Linux 上运行单元契约测试，并在 macOS 上运行完整 Electron 测试。Provider 契约测试使用 Pi SDK 连接本机 HTTP/SSE fixture，覆盖 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Google Generative AI；不需要真实 Provider 账户，也不使用个人 Pi 数据。

### 本地打包

~~~sh
# 构建当前平台的未打包应用
pnpm package:dir
pnpm test:packaged

# 构建原生安装包
pnpm package:mac
pnpm package:win
pnpm package:linux
~~~

macOS 打包会生成 arm64 和 x64 版本。可以分别指定架构运行打包冒烟检查：

~~~sh
PIPILOT_PACKAGED_ARCH=arm64 pnpm test:packaged
PIPILOT_PACKAGED_ARCH=x64 pnpm test:packaged
~~~

检查会验证指定应用的架构；缺少对应构建时会失败，不会改测另一个架构。Apple Silicon 运行 Intel 版本需要 Rosetta。打包冒烟测试检查的是未解包的应用目录，不代表完整 DMG、NSIS 或 DEB 安装流程已验证。

## 架构

应用由 Electron Main、sandbox preload 和 React renderer 组成。Renderer 不能直接访问 Node.js、文件系统或 Pi。跨进程数据通过共享的 Zod 契约和白名单 IPC 传递。

| 路径 | 内容 |
| --- | --- |
| `src/main/` | Pi Runtime、文件、终端、配置及 Electron Main 服务 |
| `src/preload/` | Sandbox preload 和 IPC facade |
| `src/shared/` | 跨进程契约与领域类型 |
| `src/renderer/` | Renderer adapters 与纯逻辑 |
| `src/components/`、`src/store/` | React 界面与状态管理 |
| `tests/` | Unit、Electron、integration 和 packaged smoke 测试 |

## Pi 配置与数据

PiPilot 不会扫描磁盘寻找项目，也不会自动把主目录当作项目。项目目录只能通过系统文件夹选择器选取。无项目聊天使用应用私有工作目录，Session 仍保存在 Pi 的官方 Session 目录中。

默认 Pi Agent 目录是 `~/.pi/agent`。设置环境变量 `PI_CODING_AGENT_DIR` 可指定其他目录；Pi Runtime、包管理、模型编辑器和全局 MCP 编辑器都会使用该目录。

| 路径 | 用途 |
| --- | --- |
| `~/.pi/agent/settings.json` | Pi 全局设置与默认模型 |
| `~/.pi/agent/models.json` | 自定义 Provider 与模型 |
| `~/.pi/agent/auth.json` | Pi SDK 管理的认证 |
| `~/.pi/agent/mcp.json` | 全局 MCP 配置 |
| `~/.pi/agent/sessions/` | Pi 官方 Session |
| `<project>/.pi/settings.json` | 项目级 Pi 设置 |
| `<project>/.mcp.json` | 项目级 MCP 配置 |

MCP 配置遵循 PiPilot 的扩展约定；Pi 核心本身没有定义 MCP 配置格式。外观、导航和窗口偏好单独保存在 Electron 应用数据目录。请勿提交包含 API Key、Token 或真实 Session 内容的文件。

## External Control

External Control 是区别于 Pi 出站 MCP 设置的可选入站 MCP 接口，可在 **设置 > Integrations** 中启用，默认关闭。

启用后，PiPilot 可以安装或修复 `pipilot-mcp` 启动器，并显示以下客户端配置：

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

MCP 客户端会启动 stdio 进程，通过仅限当前用户使用的认证 Unix socket（macOS/Linux）或命名管道（Windows）连接正在运行的应用。PiPilot 不会开放网络监听端口。该接口支持有界的对话列表和状态查询、Prompt 与 Abort 操作、操作回执及等待；不会提供对话历史、凭据或 Session 文件路径。

启动器由用户显式管理。PiPilot 只会更改自己的启动器文件和当前用户的 PATH 注册，不会编辑 Codex、Claude Code、Pi、shell profile 或项目 MCP 文件。

## 发布与贡献

稳定版标签会启动完整发布验证。各平台安装包经过检查并通过 packaged smoke 后，GitHub Release 才会公开。构建目标定义在 `electron-builder.yml`，打包检查位于 `tests/packaged/`。

贡献时请使用 pnpm 和冻结的 lockfile。修改前阅读相关实现与测试；不要提交个人配置、凭据、构建输出或生成的测试报告。

## 许可证

[MIT](LICENSE)
