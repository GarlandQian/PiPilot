# Changelog / 更新日志

Each version section supplies the highlights for its GitHub Release. Download links and checksums come from that release's validated build inventory.

每个版本的条目用于生成 GitHub Release 变更说明，下载链接和校验清单由该版本实际构建产物生成。

## Unreleased

### 中文

- **免责声明与第三方许可**：“设置 › 关于”新增“法律信息”：免责声明（独立项目、仅限合法使用、AI 输出需自行审阅、费用与条款、数据、商标与图标、不提供担保），以及构建时自动生成的第三方许可清单，可查看此版本包含的每个开源软件包及其许可证全文。致谢列出 PiPilot 依赖的主要开源项目；“添加服务商”和 MCP 模板页面不再单独标注出处。README 同步加入免责声明和致谢。

### English

- **Disclaimer and third-party notices:** Settings › About adds Legal: a disclaimer (an independent project, lawful use only, review what AI produces, providers and costs, your data, trademarks, no warranty) and Third-Party Notices, generated at build time, listing every open-source package in the build with its license text. Acknowledgements name the main projects PiPilot builds on; Add Provider and the MCP templates no longer carry their own credit lines. The README gains the disclaimer and acknowledgements.

## 0.12.0

### 中文

- **应用扫描去重**：Windows 启动别名与实际安装文件确认属于同一安装时合并展示，原默认选择仍可使用。相同启动配置的手动条目合并展示且仍可分别编辑或移除；独立安装、不同参数、环境变量及 WSL 工作目录行为保持区分。

### English

- **Deduplicate discovered apps:** Group Windows execution aliases with their verified installation targets while retaining saved selections. Equivalent manual launch entries share one row and remain individually editable or removable; separate installations, arguments, environment overrides, and WSL working-directory behavior stay distinct.

## 0.11.0

### 中文

- **失败回复与重试**：回复失败时显示错误类别、服务商和模型、脱敏后的详情及“重试回复”按钮；自动重试显示次数和等待倒计时，可停止等待。在“设置 › 模型”中配置自动重试开关和次数，保存在 Pi 的全局配置，可信项目的覆盖设置继续生效。认证或配置错误不再因错误文本中的端口或数字而被误判为临时故障；停止重试后保留失败回复和手动重试入口。
- **精简打包与加快发布**：移除安装包内重复的前端依赖和其他平台的终端预编译文件；源码验证与打包并行，Electron 测试分片运行，macOS Intel 检查不再等待 Windows/Linux。保留全部平台安装包和发布前检查。
- **归档后立即离开列表**：归档正在打开的任务会转到所在项目的新任务（与 Codex 一致），已归档的任务不再因为仍在运行或有未读结果而留在侧边栏；它们仍可在“已归档”、搜索和通知中找到。

### English

- **Failed replies and retries:** Show the error category, provider and model, redacted details, and a Retry Reply action. Automatic retries show the attempt count and countdown and can be stopped. Configure automatic retry and its count in Settings › Models, saved in Pi's global configuration while respecting trusted project overrides. Authentication and configuration failures no longer retry because a port or number in their text resembles a transient error; stopping retries keeps the failed reply and manual retry action visible.
- **Smaller packages and faster release builds:** Omit duplicate renderer dependencies and terminal prebuilds for other platforms. Run verification alongside packaging, shard Electron tests across machines, and start Intel macOS checks without waiting for Windows/Linux. Keep every platform's installers and all publication checks.
- **Archiving takes a task out of the list:** Archiving the open task moves on to a new task in its project, as in Codex, and archived tasks no longer linger in the sidebar while running or unread; they remain in Archived, search and notifications.

## 0.10.0

### 中文

- **打开方式合并编辑器和终端**：工具栏和文件查看器的“打开方式”菜单与 Codex 一致，按编辑器、终端、默认应用和访达分组；主按钮使用上次用过的应用，选终端时在文件所在文件夹打开。每次打开菜单都会重新查找，新装的应用无需重启即可出现。
- **找到更多应用**：内置名单与 Codex 对齐，新增 Antigravity、Devin、Rider、RustRover、PhpStorm、GitHub Desktop、Visual Studio、Warp、kitty、WezTerm、Alacritty、Tabby 等；Windows 新增 PowerShell 7、Git Bash、Cmder、WSL，并从开始菜单快捷方式、App Paths 和 scoop 查找；Linux 读取 .desktop 启动项；macOS 识别带版本号的应用名。
- **手动添加任意应用**：“设置 › 常规 › 打开方式”可添加名单里没有的编辑器或终端，可选择应用并填写参数（支持 {path}、{dir}、{line}）。原“终端 › 外部终端应用”的设置合并到这里，已添加的应用和默认终端保持不变。
- **外部控制图标**：MCP 客户端连接 PiPilot 时显示标题“PiPilot”和应用图标；设置中的“外部控制”改用 π 图标。
- **全局动画**：侧边栏和右侧面板的显示与隐藏、侧边栏项目、文件夹、工具卡片和计划的展开收起、对话与排队消息的增删、设置页的进入与返回、标签页切换，以及菜单和对话框的退场都改为 macOS 式的平滑动画。开启“减少动画”或系统的减少动态效果时全部关闭。

### English

- **Open In covers editors and terminals:** The Open In menu in the toolbar and file viewer matches Codex, grouped as editors, terminals, the default app, and Finder. The main button uses the app you used last; a terminal opens the file's folder. Each opening rescans, so an app installed meanwhile shows up without a restart.
- **More apps found:** The built-in list matches Codex's, adding Antigravity, Devin, Rider, RustRover, PhpStorm, GitHub Desktop, Visual Studio, Warp, kitty, WezTerm, Alacritty, Tabby and more. On Windows it adds PowerShell 7, Git Bash, Cmder and WSL, and looks in Start menu shortcuts, App Paths and scoop; on Linux it reads .desktop launchers; on macOS it recognizes versioned app names.
- **Add any app:** Settings › General › Open In adds an editor or terminal the list doesn't know: choose the app and, optionally, its arguments ({path}, {dir}, {line}). Terminal › External terminal applications moved here; added apps and the default terminal are kept.
- **External Control icon:** MCP clients that connect to PiPilot show its title and app icon; External Control in Settings uses the π mark.
- **Motion throughout:** Showing and hiding the sidebar and inspector, expanding projects, folders, tool cards and plans, adding and removing conversations and queued messages, entering and leaving Settings pages, switching tabs, and closing menus and dialogs now move smoothly, the macOS way. Reduce Motion in PiPilot or the system turns it all off.

## 0.9.0

### 中文

- **多模型并行对比**：在输入框的 + 菜单选择“并行对比…”，把同一任务同时交给 2–4 个模型，每个模型在当前分支的独立工作副本中完成；“对比”标签页并排显示各自的回答和改动，可查看差异，并一键以三方合并应用到项目工作区。可选让一个模型评判并推荐；侧边栏列出项目的对比。
- **PR 与 CI**：右侧面板新增“PR”标签页，通过你自己的 GitHub CLI（gh）列出与你相关或所有打开的拉取请求，查看检查和审阅状态；可批准、要求修改或评论（提交前确认身份）。检查失败时“修复失败的检查”会在该分支的工作副本中带着失败日志开始一个对话，不会推送。未安装或未登录 gh 时显示指引。
- **内置浏览器**：右侧面板新增“浏览器”标签页，同一项目下的对话共用，支持多标签页；页面运行在与 PiPilot 隔离的环境中，默认打开项目运行命令启动的开发服务器。可标注元素或区域，把截图、选择器、HTML、关键样式和说明（可选附带控制台错误）加入消息；Pi 可通过只读工具查看页面截图、地址和控制台/网络错误。
- **对话弹窗与待处理跳转**：可在新窗口中打开对话（标题栏菜单或侧边栏菜单），弹窗显示对话内容并可发送、排队、停止，支持置顶；与主窗口共用同一对话。⌘⌥A（Windows/Linux 为 Ctrl+Alt+A）或命令面板可跳到下一个需要处理的对话（等待回答、失败或有未读结果）。
- **会话分支**：可编辑之前的提问并重新发送，在同一对话中产生新分支；被编辑过的提问显示“‹ 1/2 ›”可切换版本。新增“分支”标签页显示全部分支，可切换（可先总结被离开的分支）、从任一提问编辑，并添加书签。所有分支都保留在 Pi 会话文件中。
- **MCP 实时状态**：对话标题栏显示“已连接/总数”，可查看每个 MCP 服务器的状态、工具数、错误和输出，并直接重新连接或登录；设置中的 MCP 列表显示当前对话最近看到的连接结果。
- **订阅账号登录**：在“模型”中为 Pi 自带的服务商（Anthropic、ChatGPT、GitHub Copilot、OpenRouter、xAI 等）使用浏览器登录订阅账号，支持浏览器回调、设备验证码和粘贴代码；登录前会提示替换已保存的 API Key，可随时退出登录。
- **压缩与会话明细**：“压缩对话…”可填写需要保留的内容（等同 `/compact <说明>`），Pi 正在回复时会先提示将中断；对话菜单显示输入、输出、缓存 token 以及消息和工具调用数。
- **更多导出和导入格式**：整段对话可导出为 Pi 渲染的 HTML 或 Pi 会话文件（.jsonl）；可导入 Pi 会话文件，只恢复当前分支的消息，并自动选中其记录目录对应的项目。
- **项目信任**：接入 Pi 的项目信任机制。添加带有 `.pi` 扩展、MCP、技能等资源的项目时会询问一次，可信任此文件夹、上级文件夹或仅本次运行；未决定前对话照常可用但不加载这些资源。决定保存在 Pi 的 `trust.json`，与命令行共用；可在“本地环境”修改单个项目，在“常规”设置新项目的默认方式。已添加的项目视为已信任，新工作副本沿用来源项目的决定。

### English

- **Compare models side by side:** Choose Compare Models… in the composer's + menu to send one task to 2–4 models at once, each in its own working copy of the current branch. The Compare tab shows their answers and changes side by side, opens each diff, and applies the chosen one to the project's working tree with a three-way merge. An optional judge model recommends one; the sidebar lists the project's comparisons.
- **Pull requests and CI:** A Pull Requests tab lists the open pull requests that involve you (or all of them) through your own GitHub CLI, with their checks and review state. Approve, request changes, or comment after confirming the account it posts as. Fix Failing Checks opens the branch in a working copy and starts a conversation with the failing output; nothing is pushed. Without gh, or signed out, the tab shows how to set it up.
- **Built-in browser:** A Browser tab in the side panel, shared by a project's conversations and with multiple tabs. Pages run isolated from PiPilot and default to the dev server a project action started. Annotate an element or an area to add its screenshot, selector, HTML, key styles, and your note (optionally with console errors) to the message. Pi gets read-only tools to see the page's screenshot and address and its console and network errors.
- **Pop-out windows and attention navigation:** Open a conversation in its own window from the header or sidebar menu. The window shows the transcript, sends, queues, and stops, and can stay on top; it shares the conversation with the main window. ⌘⌥A (Ctrl+Alt+A on Windows and Linux) or the command palette opens the next conversation needing attention: waiting for you, failed, or unread.
- **Conversation branches:** Edit an earlier question and send it again to start a new branch in the same conversation; an edited question shows ‹ 1/2 › to switch versions. A Branches tab lists every branch, switches between them (optionally summarizing the one left behind), edits from any question, and bookmarks questions. Every branch stays in the Pi session file.
- **Live MCP status:** The conversation header shows how many MCP servers are connected. Open it to see each server's state, tool count, errors, and output, and reconnect or sign in right there. Settings › MCP shows what the open conversation last saw.
- **Subscription sign-in:** Sign in to Pi's own providers (Anthropic, ChatGPT, GitHub Copilot, OpenRouter, xAI, and more) from Models with a browser callback, a device code, or a pasted code. PiPilot asks before replacing a saved API key, and you can sign out at any time.
- **Compaction and session details:** Compact conversation… accepts instructions for what the summary keeps (like `/compact <instructions>`) and warns first when it would stop a reply. The conversation menu lists input, output, and cache tokens, messages, and tool calls.
- **More export and import formats:** Export a whole conversation as Pi's HTML page or as its Pi session file (.jsonl). Import a Pi session file to restore the messages on its current branch, with the project it was recorded in preselected.
- **Project trust:** Follow Pi's project trust. Adding a project with `.pi` extensions, MCP servers, skills, or other resources asks once: trust the folder, its parent, or this run only. Until you decide, conversations work without those resources. Decisions are saved in Pi's `trust.json` and shared with the CLI; change a project in Local environment and the default for new projects in General. Existing projects stay trusted, and new working copies inherit their source project's decision.

## 0.8.0

### 中文

- **改进模型信息补全**：优先使用 models.dev，并通过模型规范 ID 匹配不同服务商提供的同一模型；依次采用当前服务商、模型厂商和多来源共识信息，未知模型仍回退到 Pi 内置目录。
- **标明目录来源与参考价格**：编辑自定义模型时说明信息来自哪个目录及服务商/厂商；厂商价格会明确标为参考价，并根据模型目录自动补全其支持的 thinking levels，不覆盖已有自定义值。

### English

- **More accurate model details:** Prefer models.dev and use canonical model IDs to match the same model across providers. Fill details from the endpoint provider, then the model maker, then source consensus; unknown models still fall back to Pi's built-in catalog.
- **Model attribution and reference pricing:** Show which catalog and provider or maker supplied model details. Clearly label a maker's price as a list-price reference, and fill supported thinking levels without overwriting existing custom values.

## 0.7.0

### 中文

- **重做设置界面**：设置按偏好、Pi 配置和应用管理分组，统一列表、说明和编辑页样式；模型、MCP、终端配置和扩展包使用独立页面与编辑面板。
- **增加本地环境管理**：按项目配置安装、测试、开发等命令，可设工作目录和系统专属命令；在工作区运行并查看实时输出和历史记录。支持从分支创建 Git 工作副本，可选运行初始化命令，并可归档、恢复和切换工作副本。
- **快捷运行项目命令**：项目工具栏可一键运行上次使用的命令，也可选其他命令、停止运行中的命令或打开输出；工作副本可沿用来源项目的命令配置。
- **拆分扩展与外部控制管理**：扩展包、Pi 资源、本地环境和外部控制各有独立设置页，便于查看安装状态、资源、项目操作和 MCP 启动器连接状态。

### English

- **Redesigned Settings:** Organize preferences, Pi configuration, and app management into focused groups with consistent lists, guidance, and editors. Models, MCP, terminal profiles, and extensions each have dedicated pages and editing sheets.
- **Local environment management:** Configure per-project install, test, and development commands, including working directories and platform-specific variants. Run them from the workspace and inspect live output and history. Create Git worktrees from a branch, optionally run a setup command, and archive, restore, or switch worktrees.
- **Run project actions from the toolbar:** Run the last-used action with one click, choose another action, stop a running command, or open its output. A worktree can reuse its source project's action configuration.
- **Separate extension and external-control settings:** Give packages, Pi resources, local environment, and external control dedicated pages for reviewing installation state, resources, project actions, and MCP launcher connections.

## 0.6.0

### 中文

- **改进项目终端**：终端「＋」使用默认 Shell，下拉菜单可临时选择其他 Shell；支持刷新发现列表和自定义配置，记住不可用的默认项。项目、文件夹和文件可直接在对应目录打开终端，重启终端保留原工作目录。
- **支持外部终端**：单独选择默认终端应用，支持 macOS Terminal、iTerm2、Ghostty，Windows Terminal、PowerShell、CMD 和常见 Linux 终端，也可配置应用路径；打开其他项目的外部终端不会切换当前对话。改善 Windows Store 终端执行别名的发现。
- **稳定项目启动体验**：空项目「开始任务」入口在会话列表后台刷新时保持稳定，避免新建任务后侧栏反复切换加载状态。
- **升级 Pi 运行时至 1.1.0**：适配新的会话事件和取消状态；MCP 项目配置支持只覆盖全局服务器的启用状态和工具暴露方式，保留 OAuth 元数据并校验配置范围，兼容旧的 codemode-deferred 配置。
- **澄清模型协议与认证**：按 API 协议显示地址、凭据和模型 ID 提示，只为支持的协议查询模型列表；改进 Vertex 和 Bedrock 内置供应商的密钥登录步骤，避免将密钥提交到不匹配的认证字段。
- **升级说明**：Pi 1.1 的内置 Azure 供应商 ID 改为 `azure`。旧配置中的供应商引用 `azure-openai-responses` 需手动更新或重新登录，API 协议字段仍保持 `azure-openai-responses`；应用不会自动改写个人认证配置。Electron 升至 44.7.0，并同步相关依赖和构建工具。

### English

- **Project terminals:** The plus button uses the default shell; its menu can launch another shell without changing that default. Refresh discovered shells, manage custom profiles, retain unavailable defaults, and open terminals at a project, folder, or file's parent directory. Restarting a terminal preserves its working directory.
- **External terminals:** Choose a separate default terminal app, including Terminal, iTerm2, and Ghostty on macOS, Windows Terminal, PowerShell, and CMD on Windows, and common Linux terminals, with custom executable paths supported. Opening another project's external terminal leaves the active conversation unchanged. Windows Store terminal execution aliases are detected more reliably.
- **Stable project startup:** Keep an empty project's Start task entry stable during background session-list refreshes, avoiding repeated loading-state changes after creating a task.
- **Pi runtime 1.1.0:** Adapt session events and cancellation state. Project MCP configuration can override only a global server's enablement and tool exposure; OAuth metadata and configuration scopes are validated, and legacy codemode-deferred settings remain compatible.
- **Model protocol and authentication guidance:** Show protocol-specific endpoint, credential, and model-ID hints, and fetch model lists only for supported protocols. Handle the built-in Vertex and Bedrock key-login steps without sending secrets to unrelated authentication fields.
- **Upgrade note:** Pi 1.1 renames the built-in Azure provider ID to `azure`. Manually update old `azure-openai-responses` provider references or sign in again; keep the API protocol field as `azure-openai-responses`. Personal authentication files are not automatically rewritten. Electron moves to 44.7.0 alongside dependency and build-tool updates.

## 0.5.0

### 中文

- **重做模型设置**：通过供应商卡片和独立编辑页管理模型，提供常用供应商、地区与套餐预设；Pi 内置供应商可直接保存或移除 API Key，自定义接口支持获取模型列表、手动添加和连接测试。
- **补全模型信息**：结合 Pi 内置目录和可关闭的 models.dev 在线目录补全模型能力、上下文长度与价格；在线目录保留本地缓存，未知模型明确显示能力未知。对话模型菜单可直接进入添加供应商流程。
- **更清晰的配置编辑**：模型与 MCP 编辑页支持表单和 JSON 同步，敏感字段默认遮罩，保留已有高级配置；离开未保存的编辑页会提示，修改供应商 ID 时会同步其默认模型归属。
- **重做 MCP 管理**：新增常用服务器模板、粘贴配置，以及从 Claude Code、Claude Desktop、Codex、Cursor、Gemini CLI、VS Code 和 Windsurf 导入。导入前可预览和选择，已有同名服务器保留，来源文件不变；可直接启用、停用、编辑或移除服务器。
- **修复 Windows npm 与对话启动**：安装版和便携版附带独立 Node.js、npm、npx，供新建／打开对话、Pi 扩展包、npm 脚本和 stdio MCP 使用，不再依赖 fnm 的终端初始化或系统 npm。保留明确配置的其他包管理命令，不改写系统 PATH。
- **改善桌面启动环境**：macOS／Linux 从桌面启动时尝试读取交互式登录 Shell 环境，让已安装的 npx、cargo 等命令可供 Pi、MCP 和终端使用；读取失败或超时保留原环境。uvx、独立原生 MCP 程序等仍需自行安装。

### English

- **Redesigned model settings:** Manage providers through cards and dedicated editors, with common provider, region, and plan presets. Store or remove API keys for Pi's built-in providers; fetch model lists, add models manually, and test custom endpoints.
- **Model metadata:** Fill capabilities, context lengths, and pricing from Pi's catalog and the optional models.dev catalog, with a local cache for offline use and explicit unknown-capability labels. Open provider setup directly from the conversation's model menu.
- **Clearer configuration editing:** Model and MCP editors synchronize forms with JSON, mask sensitive fields by default, and preserve advanced configuration. Unsaved edits receive an exit prompt; renaming a provider ID also moves its default-model selection.
- **Redesigned MCP management:** Add common server templates, paste configuration, or import selected servers from Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, VS Code, and Windsurf. Preview imports, preserve existing names and source files, and enable, disable, edit, or remove servers in place.
- **Windows npm and conversation startup:** Setup and portable editions include standalone Node.js, npm, and npx for new/resumed conversations, Pi packages, npm scripts, and stdio MCP servers, without depending on fnm shell initialization or system npm. Explicit custom package-manager commands are preserved; the system PATH is not modified.
- **Desktop launch environment:** On macOS and Linux, desktop launches try the interactive login shell's environment so installed commands such as npx and cargo are available to Pi, MCP servers, and terminals. Failures or timeouts retain the original environment. Other runtimes such as uvx and standalone native MCP programs still need installation.

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
