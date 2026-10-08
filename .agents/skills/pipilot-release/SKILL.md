---
name: pipilot-release
description: Prepare, version, verify, and publish PiPilot desktop releases through this repository's GitHub Actions workflow. Use for PiPilot release requests or release failures, not general documentation edits.
---

# PiPilot 发布

在仓库根目录执行。流程以 `.github/workflows/release.yml`、`verify.yml` 和 `build/` 中的发布脚本为准。此 Skill 保存在项目内部，无需在 README 添加入口。

## 范围与版本

- 仅准备文档或试构建时，不推送标签或公开 Release。用户已明确要求提交、升版并发布时，直接完成这些步骤，不重复索取授权。
- 检查工作区、当前分支、远程、最新公开 Release 和现有标签；保留用户工作，只提交请求范围内的内容。
- 使用现有 Git 身份，检查 `git config --show-origin --get user.email` 和实际 author / committer。用户使用全局 noreply 邮箱；不要改作者、添加代理共同作者或重写历史。
- 稳定版必须是递增的 `x.y.z`，标签为 annotated `vx.y.z`。未指定版本时根据变更选择补丁或次版本并说明，不复用已有标签。
- 同步 `package.json` 的 `version` 和 `src/shared/build-info.ts` 的 `PIPILOT_VERSION`。仅在依赖变更时刷新锁文件；按需调整 README 的版本示例。
- 本次变更写入 `CHANGELOG.md` 的 `## x.y.z`，保留独立的 `## Unreleased`。中英文说明写具体用户行为，不能把待发布功能算到旧版本。Release 正文从该文件生成，不在脚本中硬编码版本亮点。

## 本地验证与预览

使用 Node.js 24.18.0、pnpm 12.8.1 和冻结锁文件。按变更执行检查；同一代码状态的已有通过结果可复用，不为流程形式重复完整测试。

~~~sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm build
node build/release-preflight.cjs ''
git diff --check
~~~

界面或 Runtime 变更运行对应 Electron / packaged 测试。`pnpm test:electron` 已包含 integration 场景。Windows / Linux 原生安装检查仅在受保护的一次性 runner 上执行，不在开发者机器强开 canary。

在已存在的临时目录预览说明，无需构建所有平台：

~~~sh
node build/release-notes.cjs <version> <temporary-directory>/release-notes.md --preview
~~~

预览不会宣称已发布。正式说明要求对应版本的非空 CHANGELOG 条目和完整产物目录；工作流先校验 manifest / checksum，再生成说明。

## 打包与更新契约

| 平台 | 原生构建 | 用户安装包 | 更新行为 |
| --- | --- | --- | --- |
| macOS | `pnpm package:mac` | arm64 + x64 DMG / ZIP | 自动检查，手动安装；ad-hoc，未 Developer ID 签名或公证 |
| Windows x64 | `pnpm package:win:update` | Setup EXE + portable EXE / ZIP | Setup 应用内下载并确认安装；portable 手动替换，保留 data/ |
| Linux x64 | `pnpm package:linux:update` | AppImage / DEB / RPM | AppImage 应用内更新；DEB / RPM 手动安装 |
| Linux ARM64 | `pnpm package:linux:arm64:update` | AppImage / DEB / RPM | 同 Linux x64 |

- Windows portable 独立打包，不能覆盖 NSIS unpacked 目录或更新 feed。便携 EXE 临时解压，稳定 MCP 启动器使用安装版或便携 ZIP。
- 文件名包含系统和架构。Linux 允许 x64 的 amd64 / x86_64 及 ARM64 的 aarch64 别名；下载链接读取 manifest 真实文件名，不自行拼猜。
- 四组 inventory 为 macos、windows、linux、linux-arm64，共 13 个用户安装包，另有 manifest、SHA256SUMS、更新 YAML 和 blockmap。附件总数以校验脚本为准。
- 更新 metadata 为 latest.yml、latest-linux.yml、latest-linux-arm64.yml。当前 macOS 不能发布 latest-mac.yml。没有签名凭据时，不能宣称 Developer ID / Windows 已签名或 macOS 自动安装。
- 完整门禁包括三系统 unit、真实 Electron、macOS arm64 / 原生 Intel smoke、Windows NSIS 更新和便携 EXE / ZIP 检查，以及 Linux 双架构 AppImage 原生更新与 DEB 安装。RPM 仅检查 metadata / payload，不能称为实测 RPM 安装升级；完整 macOS DMG 安装流程也未覆盖。

## 提交、推送与发布

查看并暂存请求范围内的文件，核对 staged diff 和身份后提交、推送当前发布分支。下列占位值必须换成实际值，不固定推送 main 或所有标签。

可先在已推送分支试构建，新打包流程尤其适合这样验证：

~~~sh
gh workflow run release.yml --ref <branch> -f dry_run=true
gh run list --workflow release.yml --branch <branch> --limit 5
~~~

按 head SHA、ref 和触发时间找到本次 run，不引用别的成功记录。dry-run 执行完整门禁，不创建 Release；候选包在 pipilot-* Actions artifacts，说明在 release-notes-<version> artifact。

正式发布用 annotated 标签：

~~~sh
git tag -a v<version> -m "PiPilot <version>"
git push origin v<version>
gh run list --workflow release.yml --branch v<version> --limit 5
~~~

标签推送自动触发完整发布，不同时手动触发另一轮正式发布。工作流汇总、校验所有附件后创建 draft，再核对附件、公开并设置 latest。标签已推送或打包成功不等于发布完成。运行期间观察进度，失败时读取具体 job 日志。

结束前确认本次 run 成功、tag 对应正确提交、Release 非 draft / 非 prerelease、latest 指向该版本，以及四组 manifest / 校验文件 / 更新 metadata / 全部安装包齐全：

~~~sh
gh release view v<version> --json url,isDraft,isPrerelease,assets,tagName
gh api repos/GarlandQian/PiPilot/releases/latest --jq .tag_name
~~~

用实际返回的 URL 报告发布结果。

## 失败与恢复

- 基础设施偶发失败且不改源码：确认没有已公开的同版本 Release 后，可重跑失败 job。
- 试构建失败且尚未推送正式标签：可保留待发布版本号，修复后提交并重新验证。已推送正式标签后必须修改源码或配置：改用新的补丁版本和标签，不移动旧标签或强推。
- 已创建 draft 导致重跑被 preflight 拒绝：先核实标签、附件和失败阶段。未经明确授权不删 draft；说明状态，优先使用更高版本继续修复发布。不要删公开 Release 绕过检查。
- 工作流中 0.0.1 的删除旧 Actions / 替换 Release 是历史迁移特例，不用于日常发布，不降版触发。
- 网络、凭据、runner 或权限阻塞时报告实际状态；不能将候选包或预览称为已发布，也不能用修改正文替代缺失安装包和测试。
