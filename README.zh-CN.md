# PiPilot

[English](README.md) | **简体中文**

PiPilot 是基于官方 [Pi coding agent](https://github.com/earendil-works/pi) SDK 的
Electron 桌面客户端。它在项目级 utility process 中运行锁定版本的官方 SDK，展示会话、
工具调用、文件变更、终端、模型、扩展、Skills 和 MCP 配置，不维护另一套 Agent
Runtime，也不把 Pi 的数据迁移成 PiPilot 私有格式。

Pi 继续拥有 Session、配置和资源，PiPilot 负责桌面使用体验。

> **项目状态：**`v0.0.5` 是当前稳定版，`v0.0.4` 是上一稳定版。源码仓库和
> GitHub Release 均公开；未签名安装包只有在原生构建和 packaged smoke 验证通过后
> 才用于手动下载。

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

当前源码正在采用对话优先的新工作台。已安装的发布版可能仍显示之前的界面。

## 主要能力

- **官方内置 Pi Runtime**：在隔离的 Electron utility process 中运行锁定的官方 Pi
  SDK `0.85.1`，同时保留 Pi 自己的 Session 和配置文件。
- **项目与日常聊天**：项目目录只能由用户明确选择；也支持不绑定项目的聊天，不会把主目录
  自动当作项目。
- **真实 Pi Session**：按项目浏览 Session，并使用已经接入的创建、打开、命名、复制、
  Fork 和删除等 Pi 能力。
  点击项目名直接进入工作区，旁边的操作创建项目会话；支持搜索、全部/运行中筛选和最近/名称排序。
  目录以有界批次继续扫描超过 200 个会话，刷新时复用未变文件的元数据；打开和删除仍重新验证实际会话文件。
- **完整对话体验**：提问居右、回复居左，每轮独立执行记录；消息、思考、提醒、排队内容和工具/子代理说明统一渲染 Markdown，代码与配置保留原文。
  支持代码块、工具调用、Queue、Follow-up、Steer、模型与
  Thinking 控制。运行中发送默认排队，发送与停止操作分开；排队图片和长消息可展开查看。
  未发送的文字、图片与上下文引用按会话分别保留，切换后可以恢复；草稿只保存在内存中，退出应用后不保留。
  历史执行记录默认收起，当前展开的记录不会在完成后自动收回；思考保留独立可见入口，不随工具记录隐藏。
  重载历史时保留新到的流式输出；工具完成事件缺失时，以已保存的最终结果恢复状态。
  新错误会展开提示，通知和操作卡始终可见。
  长提问按需展开，附件始终单独显示。
- **Commands、Skills 与上下文**：输入 `/` 搜索 Commands 和 Skills；输入 `@` 引用
  项目文件或 Skill，并支持键盘导航。
- **开发工作面板**：通过视图菜单切换文件、连续 Changes/Diff 和终端。
  多个文件标签保留阅读状态，支持刷新和逐个关闭；对话标题栏可搜索并跳转轮次，不打断右侧文件查看。
  文件树刷新保留展开与选中位置；连续变更支持搜索定位。终端提供状态、复制、清空显示及退出后重连。
- **Pi 集成管理**：查看和管理 Packages、Resources、Extensions、Skills、Prompts 和
  Themes，并安全重载 Runtime。存在受保护的后台任务时延后应用；重载失败不会自动重启 Host。
- **MCP 管理**：编辑全局 `~/.pi/agent/mcp.json` 和当前项目 `.mcp.json`；提供结构化
  表单与 Raw JSONC 编辑，并保留注释和未知字段。Models/MCP 草稿在设置导航中保留于
  有界内存；文件保存与 Runtime 应用分别报告结果。
- **入站对话 MCP**：在设置页现有 Integrations 标签中明确启用仅本机的 External
  Control，即可通过打包后的 stdio MCP 命令查看有界对话元数据，并向精确对话发送
  Prompt。它默认关闭，使用仅当前用户可访问的 Unix socket 或命名管道，不暴露历史
  Transcript、Token 或 Session 文件路径。
- **模型管理**：管理 Pi `models.json`、自定义 Provider/Model、默认模型和高级 JSON
  字段。可搜索的供应商列表与详情共用同一份表单/JSON 草稿，配置修改后旧测试结果失效。
- **偏好设置**：可搜索的分类导航、即时外观预览与自定义字体。普通设置合并写入磁盘后才报告保存成功，失败时恢复已保存值；退出时等待进行中的配置保存，并将尚未提交的供应商、模型和 MCP 表单纳入保存/放弃/取消确认。
- **桌面体验**：浅色/深色主题、中英文界面、可配置终端字体、键盘操作，以及
  `1100×680` 最小窗口布局。

PiPilot 目前只支持 Electron 桌面应用，不提供 Web 版本。

## 设计原则

1. **Pi 拥有数据，PiPilot 提供体验**：Session、模型、扩展和配置继续使用 Pi 的官方
   文件与目录。
2. **优先使用官方能力**：Pi RPC 已提供的功能直接接入官方协议；PiPilot 不维护平行的
   Agent 实现。
3. **官方 Pi SDK 优先**：PiPilot 使用锁定的公开 Pi SDK，并从标准 Pi 环境加载全局和
   项目级插件、Skills 与资源。
4. **状态真实**：未选择、加载中、可用和错误状态分开呈现；切换 Session 时不展示上一
   Session 的数据。
5. **紧凑桌面工具**：保持安静、克制、高信息密度的开发工具界面，覆盖浅色、深色和最小
   窗口布局。

## 开发环境要求

- macOS、Windows 或 Linux
- Node.js `24.18.0`（项目 CI 使用版本）
- pnpm `12.3.4`（项目 CI 使用版本）

安装包用户不需要 Node.js、pnpm，也不需要另行安装 Pi 可执行文件。开发环境使用
`package.json` 和 `pnpm-lock.yaml` 中精确锁定的 Pi SDK 版本。

## 本地开发

```bash
git clone https://github.com/GarlandQian/PiPilot.git
cd PiPilot
pnpm install --frozen-lockfile
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:electron
```

CI 与发布复用 `.github/workflows/verify.yml`：单测在 macOS、Windows、Linux
三端运行，完整 Electron 回归在 macOS 运行，integration 是该 Electron 套件的子集。
模型协议契约使用真实已安装的 Pi SDK，连接隔离的本机 HTTP/SSE fixture，覆盖 OpenAI
Chat Completions、OpenAI Responses、Anthropic Messages 和 Google Generative AI。
验证流式输出、真实文件写入工具、工具结果回传与下一次发送，不使用真实模型账户或开发者的 Pi 数据。

应用由 Electron Main、sandbox preload 和 React renderer 组成。Renderer 不直接访问
Node.js、文件系统或 Pi，跨进程数据通过共享 Zod 契约和白名单 IPC 传递。

## 本地打包

```bash
# 当前平台的未打包目录和 packaged smoke
pnpm package:dir
pnpm test:packaged

# 原生安装包
pnpm package:mac
pnpm package:win
pnpm package:linux
```

打包冒烟默认选择当前 Node 架构。构建 macOS 两种架构后，可分别明确验证：

```bash
PIPILOT_PACKAGED_ARCH=arm64 pnpm test:packaged
PIPILOT_PACKAGED_ARCH=x64 pnpm test:packaged
```

测试会检查 Mach-O 架构；目标包缺失会失败，不会改测另一种架构。Apple Silicon 上执行
Intel 包需要 Rosetta。发布 CI 分别执行两种 macOS 架构的测试。这些冒烟检查运行已解包的
应用，不代表已经验证完整的 DMG、NSIS 或 DEB 安装流程。

当前目标和分发策略：

| 平台 | 架构 | 产物 | 信任与更新策略 |
| --- | --- | --- | --- |
| macOS | arm64、x64 | DMG、ZIP | 无 Developer ID、未公证；手动下载和安装 |
| Windows | x64 | NSIS | 未签名；可能出现 SmartScreen 或未知发布者提示 |
| Linux | x64 | AppImage、DEB | 正在验证 AppImage 更新；DEB 手动安装 |

当前 macOS 版本没有 Apple Developer ID 签名，也没有 notarization。下载后可能需要在
Finder 中右键选择“打开”，或在系统设置中明确允许。Windows 版本没有发布者签名，系统可能显示
SmartScreen 警告。Release 说明和应用会如实展示这些状态。

构建目标和打包边界见 `electron-builder.yml`，打包回归测试位于 `tests/packaged/`。

## External Control

External Control 是独立于 Pi 出站 MCP 配置的入站 MCP 边界，默认关闭，可在“设置 >
Integrations”现有标签中启用。PiPilot 可以由用户明确安装或修复稳定的
`pipilot-mcp` 启动器，并显示一份可复制的通用配置：

```json
{
  "mcpServers": {
    "pipilot": {
      "command": "pipilot-mcp",
      "args": []
    }
  }
}
```

能力 Token、打包可执行文件和 descriptor 路径始终只由 Main 持有，不会进入复制的
配置。

stdio 进程不会打开 GUI，也不会监听网络端口，而是通过 macOS/Linux 的当前用户私有
Unix-domain socket，或 Windows 的命名管道连接运行中的 Main。工具型 MVP 提供有界的
对话列表/状态、幂等 Prompt 与 Abort receipt、操作状态以及有界等待；最终响应只会返回
给产生它的那个操作。关闭功能会断开客户端、移除端点并轮换凭据；应用停止或功能关闭时
stdio 会返回有界的 unavailable 错误。macOS 会把 wrapper 放在应用私有数据目录，并将
该目录前置注册到当前用户的 launchd PATH；重启从 Finder 启动的客户端后即可解析同一
命令。只有私有收据和 wrapper 仍精确匹配时，PiPilot 才会在后续启动时恢复这项注册。
Linux 仍只安装到已在 `PATH` 中的安全稳定用户目录；Windows 会把打包的
`pipilot-mcp.exe` 所在目录加入当前用户 PATH，并原样保留 Unicode 与其他 PATH 条目。
Windows 首次注册后请注销并重新登录，使之后启动的客户端继承新环境。经 PiPilot 证明
为受管的启动器也可在确认后卸载；卸载不会关闭 External Control，不会删除 Windows
打包可执行文件，只会移除 PiPilot 自己的 wrapper、收据和当前用户 PATH 注册。PiPilot
不会修改 Codex、Claude Code、Pi、shell profile 或项目 MCP 配置文件。

## Release 与更新

公开发布流程：

1. 稳定标签（例如 `v0.0.5`）先触发发布专属的完整验证任务。
2. 源码、单元测试、构建、集成和 Electron 检查通过后，macOS、Windows、Linux
   分别完成打包、产物检查和 packaged smoke。
3. 最终装配任务拒绝同名文件覆盖，并校验文件名、版本、SHA-256，以及更新元数据
   引用的安装包大小和 SHA-512。
4. Actions 创建 GitHub Release 草稿，并校验草稿中的完整资产集。
5. 只有完整验证、所有原生构建、packaged smoke、最终装配与草稿资产校验均成功后，
   Release 才会公开。首次仓库重置只允许替换 `v0.0.1`，且标签必须指向仓库唯一的根
   提交；后续发布必须提高版本号。

PiPilot 不会静默下载或安装更新。macOS 保持手动下载；Windows/Linux 的原生应用内更新
只有在官方 updater 的隔离平台测试通过后才会启用。

## Pi 配置与数据

PiPilot 不扫描磁盘寻找项目，也不会自动把主目录当作项目。项目工作目录只来自系统文件夹
选择器；无项目聊天使用应用私有工作目录，Session 仍由 Pi 存放在官方目录中。

默认 Agent 目录为 `~/.pi/agent`。设置 `PI_CODING_AGENT_DIR` 后，运行时、包管理、
模型编辑器和全局 MCP 编辑器都使用同一个目录，不会导入另一套私有数据库。

默认目录下的常见文件：

- `~/.pi/agent/mcp.json`：全局 MCP 配置
- `<项目>/.mcp.json`：当前项目 MCP 配置
- `~/.pi/agent/models.json`：自定义 Provider 与 Model
- `~/.pi/agent/settings.json`：Pi 全局设置与默认模型
- `~/.pi/agent/auth.json`：由 Pi SDK 管理的认证
- `<项目>/.pi/settings.json`：Pi 项目设置
- `~/.pi/agent/sessions/`：Pi 官方 Session

MCP 文件遵循 PiPilot 的扩展约定，Pi 核心本身没有定义 MCP 配置格式。
外观、导航和窗口偏好仍保存在 Electron 应用数据目录，与 Pi 配置分开。

请不要把包含 API Key、Token 或真实 Session 内容的个人配置提交到仓库。

## 项目结构

```text
src/main/       Electron Main、Pi Runtime、文件、终端和配置服务
src/preload/    sandbox preload 与严格 IPC facade
src/shared/     跨进程 Zod 契约和领域类型
src/renderer/   Renderer adapters、projectors 与纯逻辑
src/components/ React UI
src/store/      Renderer providers 与状态所有者
tests/          Unit、Electron、integration 与 packaged smoke
```

## 当前开发重点

- 在 macOS、Windows 和 Linux 实机验证首个公开安装包。
- 继续完善多 Pi Session Runtime 管理和 External Control 操作归属。
- 继续使用内置官方 Pi SDK 验证 Models、Integrations、入站/出站 MCP 和扩展 UI。

## 贡献

修改项目前请阅读对应实现和测试。项目使用 pnpm
和冻结的 lockfile；不要提交用户 Session、密钥、构建输出或测试报告。

## 许可证

[MIT](LICENSE)
