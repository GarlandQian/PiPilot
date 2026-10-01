# PiPilot

[English](README.md) | **简体中文**

PiPilot 是基于官方 [Pi coding agent](https://github.com/earendil-works/pi) 的 Electron 桌面客户端。它在隔离的 Electron utility process 中运行锁定版本的 Pi SDK 0.99.1，为对话、项目、文件、终端、模型和 Pi 扩展提供桌面工作区。

Pi 继续管理自己的 Session、配置和资源。PiPilot 负责桌面体验，不维护另一套 Agent Runtime，也不把 Pi 数据迁移到私有格式中。

**源码版本：**0.3.0 · [下载发布版本](https://github.com/GarlandQian/PiPilot/releases)

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

## 主要功能

- **项目与对话**：由用户明确选择项目目录，也可发起无项目聊天；浏览、搜索、整理和管理 Pi Session。可按活动状态筛选、按最近活动或名称排序，并在侧栏「显示选项」中切换归档任务。
- **对话工作区**：在同一时间线查看消息与工具活动；排队、编辑或调整后续消息；使用 Commands、Skills、文件引用、模型选择和 Thinking 控制。
- **本机草稿**：重启后恢复未发送的文字、引用和图片。草稿保存在 PiPilot 本机应用数据中；发送或清空输入后移除对应草稿，删除会话时同步清理，退出前等待未完成的草稿写入。
- **会话概览**：右侧「概览」展示简短摘要、状态与最多三条下一步草稿。展开 Plan 和 Goal 可查看对应插件的状态与操作；仅显示有内容的产出、来源、已用技能/MCP 和网页链接。
- **Markdown 导出**：导出当前对话分支、单轮回答或单条消息。工具日志可选，图片保存在 Markdown 文件旁；不导出系统指令和隐藏思考。
- **Markdown 导入**：预览文档并创建项目会话或普通聊天。新版 PiPilot 导出可恢复用户/助手历史，普通或无法识别的 Markdown 作为背景内容；不会自动发送消息、重放工具或恢复旧计划批准状态。
- **项目工具**：查看文件和 diff、搜索命令输出、检查子代理活动，并使用按项目组织的终端标签页。
- **精准引用与审阅**：选中消息、文件或命令文字后，将带来源的片段快照加入输入框；选中 Diff 行号添加评论，再集中加入草稿，由用户发送。
- **对话全文搜索**：Cmd/Ctrl+F 搜索当前消息正文，Cmd/Ctrl+Shift+F 搜索所有已添加项目，点击结果跳转到所属回复。历史会话搜索当前保存的分支；过大或不可用的会话会明确提示未覆盖。
- **侧边追问**：围绕所选文字，在右侧使用独立的官方 Pi 会话提问。关闭视图不会停止任务，也不会删除已保存的会话；点击「停止追问」请求取消，完成、取消和失败分别显示状态。
- **工作副本与项目动作**：从项目菜单创建本地 Git worktree，保存带平台覆盖的安装、测试、开发命令，明确点击运行并查看日志。创建时也可选择并确认一个已保存的 setup 动作。归档将完整工作副本移入本机保存目录，保留暂存、未暂存、未跟踪和忽略文件，不释放磁盘空间。归档前请切换到其他项目，并停止本项目终端与动作；执行中、排队中、等待交互或持有租约的会话也会阻止归档。恢复时返回原路径，路径已被占用则拒绝覆盖；Pi 会话文件保持官方原位置。不自动提交、合并或推送。
- **Pi 配置**：管理模型与 Provider、Packages、Resources、Extensions、Skills、Prompts、Themes，以及全局或项目级 MCP 设置。
- **桌面偏好**：支持系统、浅色和深色主题；可将 Liquid Glass 表面从透明调到着色，并配置语言、键盘操作和终端字体。
- **External Control**：可选的本地 MCP 接口，用于查看对话状态和控制 Prompt。默认关闭，详见 [External Control](#external-control)。

PiPilot 是 Electron 桌面应用，不提供 Web 版本。

切换项目不会停止后台会话。闲置 Runtime 缓存使用全局预算，空项目 Host 在宽限期后退出；执行中、排队中、等待交互或持有租约的工作受到保护。回收缓存不会移除左侧的会话记录。

## 桌面偏好

在 **设置 > 外观** 中选择系统、浅色或深色主题，并用 Liquid Glass 滑块调整玻璃表面的透明/着色程度。新增该偏好时会保留已有外观设置。会话侧栏始终显示「全部」「运行中」「需关注」筛选；「显示选项」可更改排序方式或显示归档任务。

**设置 > 通用** 中可独立开关完成提示音，默认开启。只有未正在查看的会话完成时响一次；中间活动、工具完成、重试与取消不响铃。

## 计划、目标与会话概览

Plan Mode 插件负责规划、修订、保存以及将计划交给代理实施。可使用 `/plan`，或在右侧「概览」展开「计划」操作。「实施」会把计划交给代理，不负责步骤完成追踪，也不保证持续执行到所有步骤完成。需要持续推进目标时使用 Goal 插件；概览单独展示它的状态与暂停/恢复操作。Subagents 负责子任务委派，活动显示在会话和子代理检查面板中。PiPilot 使用这些插件的命令与状态，不再维护第二套计划审批和执行引擎。

当前上游插件对已保存计划执行 `/plan implement` 时，没有强制与 Goal 互斥。PiPilot GUI 会在 Goal 尚未完成（包括已暂停）时隐藏 Plan 的实施、修订和定稿操作。直接输入斜杠命令仍沿用插件本身的行为；用它们开始实施计划前，请先完成或清空已有 Goal。

PiPilot 内置任务工具仅维护会话摘要、实际阻塞和最多三条下一步草稿，元数据作为自定义条目保存在官方 Pi 会话树中。历史内置计划记录保留在会话中；概览复用其中的元数据，不恢复旧批准或执行状态。旧会话在助手更新前没有生成的摘要。点击下一步建议会加入已有草稿，保留引用和图片，不会自动发送。来源与产出可跳转到对应对话记录；提到网页链接不等于实际浏览过该网页。

在左侧会话「⋯」菜单中，与置顶/归档一起找到「导出 Markdown…」。导出未打开或后台会话不会切换当前会话，也不会启动其代理；消息操作仍可导出单条消息或单轮回答。导出后请将生成的图片文件夹与 Markdown 放在一起；工作区产出链接会保留，但不会复制产出文件本身。

从项目「⋯ > 从 Markdown 导入会话…」或侧栏新建按钮旁的菜单选择文件，预览后可修改名称、选择项目或普通聊天，再确认创建。新版 PiPilot 导出包含版本化角色元数据；被编辑、旧版或无法识别的文件会作为背景文档导入，不根据标题猜测角色。图片缺失或格式不支持会提示，仅读取导出文件相邻附件目录内的受支持图片，不下载远程图片、不读取任意文件链接。文件读取上限为 Markdown 16 MiB、含附件总计 32 MiB；转换后的会话还需满足 6 MiB 的传输限制（包括图片编码数据）。超限会在预览时提示，不会创建会话。新会话具有独立身份，等待你发送下一条消息；不会恢复旧工具执行、待发送消息或计划批准，原会话保持不变。

## 下载与安装

从 [GitHub Releases](https://github.com/GarlandQian/PiPilot/releases) 下载安装包。

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| macOS | arm64、x64 | DMG、ZIP |
| Windows | x64 | NSIS |
| Linux | x64 | AppImage、DEB |

当前安装包未签名，macOS 版本也未公证。macOS 可能要求用户先批准再打开应用；Windows 可能显示 SmartScreen 或未知发布者警告。

Windows 首次安装可选择安装目录。Windows NSIS 和 Linux AppImage 版本会自动检查较新的稳定版本；由用户点击下载，再确认重启安装。重启前会检查运行中的任务和未保存的配置。Windows 更新沿用原安装目录，保留 Pi 配置和会话；下载文件通过官方更新元数据校验，安装包仍不签名。

macOS 和 Linux DEB 版本采用手动下载。使用旧版手动更新模式的 Windows 用户需要先手动安装一次新版，之后即可在应用内更新。自动更新要求版本号递增，覆盖同版本 Release 的附件不会触发更新。

## 开发

### 环境要求

- macOS、Windows 或 Linux
- Node.js 24.18.0
- pnpm 12.8.1（由 `package.json` 声明）

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

`tests/electron/renderer-performance.electron.spec.ts` 使用 1,000 条历史回复和 32 KB 流式 Markdown 测量输入响应、帧间隔与会话切换，保存 JSON 指标及 Chromium CPU profile，并验证表格、后置引用定义、完整复制和导航。耗时仅作报告，不使用依赖机器性能的固定通过阈值。

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

检查会验证指定应用的架构；缺少对应构建时会失败，不会改测另一个架构。Apple Silicon 运行 Intel 版本需要 Rosetta。普通打包冒烟测试运行 unpacked 应用目录。发布流程还会在一次性 runner 上运行受保护的安装检查：Windows 验证 NSIS 安装和升级；Linux 实际启动 AppImage，将隔离的 0.0.0 测试包原生升级为未经修改的发布候选，观察自动重启，并核对设置、Pi 配置、项目和含图片的会话保留。Linux 还会用 dpkg 安装候选 DEB，通过注册的可执行文件启动，验证手动更新策略，再卸载。两项 Linux 检查通过后才能上传候选包，并保留日志和截图。检查拒绝覆盖已有安装，用户数据和缓存全部隔离，未准备好的 CI 环境及开发者本机会跳过这些安装检查。完整 macOS DMG 安装流程尚未覆盖。

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

PiPilot 不会扫描磁盘寻找项目，也不会自动把主目录当作项目。已有项目通过系统文件夹选择器添加，也可从项目菜单创建受管理的本地 Git 工作副本。无项目聊天使用应用私有工作目录，Session 仍保存在 Pi 的官方 Session 目录中。

默认 Pi Agent 目录是 `~/.pi/agent`。设置环境变量 `PI_CODING_AGENT_DIR` 可指定其他目录；Pi Runtime、包管理、模型编辑器和全局 MCP 编辑器都会使用该目录。

PiPilot 会把缺失的 Plan Mode、Subagents 和 Goal 自动安装到这个共享的 Pi 全局目录。本版本初始适配的版本为 `@narumitw/pi-plan-mode@0.58.3`、`pi-subagents@0.74.0` 和 `@narumitw/pi-goal@0.54.8`。它们是普通 Pi 包，使用相同 Agent 目录的 Pi CLI 也能使用，无需为每个项目安装私有副本。已有安装、配置来源、版本和资源过滤设置会保留。移除默认包后会记住退出自动安装的选择，重启或升级应用也不会补装。安装失败会在 **设置 > Integrations** 显示，需明确点击重试；不会反复自动重试或静默替换已有版本。你仍可在那里自行管理或重新安装每个包。

| 路径 | 用途 |
| --- | --- |
| `~/.pi/agent/settings.json` | Pi 全局设置与默认模型 |
| `~/.pi/agent/models.json` | 自定义 Provider 与模型 |
| `~/.pi/agent/auth.json` | Pi SDK 管理的认证 |
| `~/.pi/agent/mcp.json` | 全局 MCP 配置 |
| `~/.pi/agent/sessions/` | Pi 官方 Session |
| `<project>/.pi/settings.json` | 项目级 Pi 设置 |
| `<project>/.pi/mcp.json` | 项目级 MCP 配置 |

MCP 连接使用 Pi 原生支持和标准 JSON 配置。内置 Runtime 支持 stdio 与 Streamable HTTP，无需 MCP 适配插件，也不会自动安装。已安装的用户扩展仍由你管理；Pi 会优先使用已启用的 `pi-mcp-adapter`，替代原生集成。确认原生配置后，在 **设置 > Integrations > 包** 中移除旧适配器并重新加载 Runtime，即可使用原生 MCP。PiPilot 不会自动卸载个人扩展。

PiPilot 本体使用内置 Pi，无需另行安装 Node.js。你配置的 stdio MCP 服务器仍可能需要 `node`、`npx` 或 `uvx` 等运行环境；命令必须能从应用进程的 PATH 找到，或配置为可执行文件的绝对路径。macOS 从 Finder 启动时的 PATH 可能与终端不同。打开会话时会随项目资源加载项目 MCP 配置，因此只添加可信项目。

MCP 编辑器可以把旧的项目 `.mcp.json` 导入 `.pi/mcp.json` 草稿，并将 `disabled` 转换为 `enabled`。导入后只有保存才写入新文件，原文件会保留。不支持的 socket 或仅 SSE 配置会明确报错，不会静默丢弃。外观、导航和窗口偏好单独保存在 Electron 应用数据目录。请勿提交包含 API Key、Token 或真实 Session 内容的文件。

## 定时任务

在 **设置 > 定时任务** 中，选择一个已保存的现有 Pi 会话，配置单次时间、带 IANA 时区的每日时间或固定间隔。仅在 PiPilot 运行时调度，不安装系统后台守护程序，也不依赖 External Control 开关。后台运行不会切换当前会话。

错过的时间默认最多补跑一次，也可选择跳过延迟超过一分钟的执行。上次运行未结束时跳过重叠时间。每日任务遇到夏令时不存在的时间会跳过当天，重复时间只执行一次。暂停只影响后续执行；当前运行结束后才可编辑、删除。删除保留会话及历史，立即运行是独立的一次尝试，不替换计划。

Electron 用户数据目录内的私有 `scheduled-tasks/ledger.json` 保存最多 100 个任务和最近 500 次执行。每次发送前，先将执行记录同步落盘；重启时未确认终态的记录标为「结果未知」并暂停任务，不自动重发、不假报完成。请检查对应会话后再恢复。目标被删除或替换、运行需要交互时同样暂停，不会自动批准请求。完成与失败提醒遵循桌面通知设置；账本损坏或无法保存时停止调度并保留原文件。

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
