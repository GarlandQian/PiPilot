# Changelog / 更新日志

Each version section supplies the highlights for its GitHub Release. Download links and checksums come from that release's validated build inventory.

每个版本的条目用于生成 GitHub Release 变更说明，下载链接和校验清单由该版本实际构建产物生成。

## Unreleased

## 0.5.0

### 中文

- **重做模型设置**：通过供应商卡片和独立编辑页管理模型，提供常用供应商、地区与套餐预设；Pi 内置供应商可直接保存或移除 API Key，自定义接口支持获取模型列表、手动添加和连接测试。
- **补全模型信息**：结合 Pi 内置目录和可关闭的 models.dev 在线目录补全模型能力、上下文长度与价格；在线目录保留本地缓存，未知模型明确显示能力未知。对话模型菜单可直接进入添加供应商流程。
- **更清晰的配置编辑**：模型与 MCP 编辑页支持表单和 JSON 同步，敏感字段默认遮罩，保留已有高级配置；离开未保存的编辑页会提示，修改供应商 ID 时会同步其默认模型归属。
- **重做 MCP 管理**：新增常用服务器模板、粘贴配置，以及从 Claude Code、Claude Desktop、Codex、Cursor、Gemini CLI、VS Code 和 Windsurf 导入。导入前可预览和选择，已有同名服务器保留，来源文件不变；可直接启用、停用、编辑或移除服务器。
- **改善桌面启动环境**：macOS／Linux 从桌面启动时尝试读取交互式登录 Shell 环境，让已安装的 npx、cargo 等命令可供 Pi、MCP 和终端使用；读取失败或超时保留原环境。外部服务器仍需安装相应运行环境，Windows 的 fnm 环境差异仍需单独处理。

### English

- **Redesigned model settings:** Manage providers through cards and dedicated editors, with common provider, region, and plan presets. Store or remove API keys for Pi's built-in providers; fetch model lists, add models manually, and test custom endpoints.
- **Model metadata:** Fill capabilities, context lengths, and pricing from Pi's catalog and the optional models.dev catalog, with a local cache for offline use and explicit unknown-capability labels. Open provider setup directly from the conversation's model menu.
- **Clearer configuration editing:** Model and MCP editors synchronize forms with JSON, mask sensitive fields by default, and preserve advanced configuration. Unsaved edits receive an exit prompt; renaming a provider ID also moves its default-model selection.
- **Redesigned MCP management:** Add common server templates, paste configuration, or import selected servers from Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, VS Code, and Windsurf. Preview imports, preserve existing names and source files, and enable, disable, edit, or remove servers in place.
- **Desktop launch environment:** On macOS and Linux, desktop launches try the interactive login shell's environment so installed commands such as npx and cargo are available to Pi, MCP servers, and terminals. Failures or timeouts retain the original environment. External runtimes remain required; Windows fnm environment differences still need separate handling.

## 0.4.0

### 中文

- **更多安装包**：新增 Windows x64 便携 EXE / ZIP，以及 Linux ARM64 和 RPM；macOS 继续提供 Apple Silicon / Intel 的 DMG / ZIP。所有安装包文件名均包含系统和架构。
- **随身携带数据**：Windows 便携版默认把应用数据放在程序旁的 `data/`，Pi 数据放在 `data/agent/`；升级时保留该目录即可继续使用。便携 EXE 临时解压运行，需要稳定 MCP 启动器时使用安装版或便携 ZIP。
- **自定义 Pi 配置目录**：在「设置 → 通用」选择文件夹，退出并重开后生效；默认仍为 `~/.pi/agent`（便携版除外），切换不会自动迁移或删除原有文件。
- **修复 Windows 对话启动**：应用 PATH 找不到系统 npm 时，Pi 包管理回退到内置 npm，处理打开或新建对话时的 `spawn npm ENOENT`。通过 fnm 配置的终端环境可能与桌面启动环境不同；外部 MCP 服务器仍需自己的运行环境。
- **改善 Windows MCP 启动器修复**：旧安装已移除时，可以保留旧记录备份并注册当前安装；另一份安装仍存在或记录无法验证时，显示具体冲突原因。
- **完善跨平台更新与发布说明**：便携版和 Linux RPM 自动检查更新、手动安装；Windows 安装版 / Linux AppImage 保持应用内下载并确认安装。重写中英文 README，按实际产物生成 Release 下载表。

### English

- **More package choices:** Windows x64 portable EXE / ZIP, Linux ARM64, and RPM packages join the existing macOS Apple Silicon / Intel DMG / ZIP builds. Every package filename identifies its system and architecture.
- **Portable data:** Windows portable editions keep application data in adjacent `data/` and Pi data in `data/agent/` by default. Preserve that directory when upgrading. Use Setup or portable ZIP for a stable MCP launcher; the portable EXE extracts to a temporary location.
- **Choose your Pi directory:** Select a folder in Settings → General, then quit and reopen. The default remains `~/.pi/agent` outside portable mode; changing it does not migrate or delete existing files.
- **Windows conversation startup:** Pi package management falls back to bundled npm when system npm is absent from the application's PATH, addressing `spawn npm ENOENT` when opening or creating conversations. fnm terminal environments can differ from desktop launches; external MCP servers still need their own runtimes.
- **Windows MCP launcher repair:** Repair a record for a removed installation while preserving a recovery copy and registering the current install. Existing installations and unverifiable records now receive specific conflict explanations.
- **Updates and release information:** Portable and Linux RPM builds check automatically and install manually; Windows Setup / Linux AppImage retain in-app download and confirmed installation. Rewritten English and Chinese READMEs and download tables generated from actual release assets.

## 0.3.5

### 中文

- 重新设计工作区面板、终端标签页与对话导航。
- 改善 Diff 审阅、Git 操作和外部编辑器集成。
- 在模型设置中提供快捷 Provider 配置和远程模型发现。
- 安装包文件名包含操作系统和架构。
- 「设置 → 关于」保留「检查更新」按钮，各平台支持自动检查。

### English

- Redesigned workspace panels, terminal tabs, and conversation navigation.
- Improved diff review, Git actions, and external editor integration.
- Quick provider setup and remote model discovery in model settings.
- Installer filenames identify the operating system and architecture.
- Persistent Check for updates button in Settings → About; all platforms check automatically.

## 0.3.2

### 中文

- 会话概览展示摘要、阻塞、下一步建议和插件状态。
- 支持 Markdown 对话导入、导出与相邻图片附件。
- 集成 Plan Mode、Goal 和 Subagents，使用共享 Pi 包管理。
- 回复期间支持排队、插话，以及重排或恢复未发送的消息和附件。
- 输入框菜单和快捷键可启动 Plan / Goal，并在输入区附近管理当前工作。
- 可配置完成提示音，修复 macOS 27 侧栏标题栏问题。

### English

- Conversation overview with summaries, blockers, next steps, and plugin state.
- Import and export conversations as Markdown, with adjacent image attachments.
- Plan Mode, Goal, and Subagents integration with shared Pi package management.
- Choose queue or steer while Pi replies; reorder or restore unsent messages and attachments.
- Start Plan or Goal from the composer with shortcuts, and manage active work near the input.
- Configurable completion sounds and a macOS 27 sidebar title bar fix.
