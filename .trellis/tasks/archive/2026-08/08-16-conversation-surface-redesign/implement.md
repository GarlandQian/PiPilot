# 实现计划 — 会话主界面重新设计

Phase 1–6 是 2026-08-16 已完成的第一版实现记录。用户在 2026-08-18 重新打开范围，
确认完整中间列、Composer、兼容层、提醒归属和 StatusBar 删除；当前工作从 Phase 7
继续，旧 ActivityDock / StatusBar 方案属于待替换实现而非最终验收目标。

## Phase 1 — 顶部栏 + 通知迁移（D1 + D2)

- [x] 重写 `src/components/chat/ChatHeader.tsx` 为 h-8 极简单行
      （图标 + 截断标题 + `···` 菜单 + Inspector 开关；compact 动作进菜单）。
- [x] `src/components/frame/StatusBar.tsx` 新增通知按钮（TbBell + 严重度
      圆点 + 计数）与向上 Popover 通知列表（dismiss 走
      `actions.dismissNotification`)；空态文案。
- [x] `src/App.tsx`：移除会话列顶部的 `<ExtensionNotifications>` 内联横幅，
      把 `extension.notifications` / `onDismiss` 传给 StatusBar。
- [x] i18n:`statusbar.notifications` / `statusbar.notifications.empty`
      （双语）。
- [x] 验证：tsc + build。

## Phase 2 — 统一底部 Dock(D3)

- [x] 新建 `src/components/chat/ActivityDock.tsx`:
  - 标签行 h-7，仅活跃表面出现 tab;sage 激活指示条；
  - 内容区 min-h-20 / default 128px / max 40vh，顶部 4px 垂直拖拽热区；
  - 收起为仅标签行；无活跃表面时不渲染；
  - 键盘:tab focus、ArrowLeft/Right 切换、Escape 收起;
    reduced-motion 无动画。
- [x] 将 PlanActivityBlock / GoalActivityBlock / ExtensionActivityStrip /
  RetryActivityBlock 的内容渲染搬进 Dock tab(块内部渲染逻辑保持不变，
  只换外壳）；保留各 Block 导出以便回滚期对比。
- [x] `src/App.tsx`：会话列底部四个独立块替换为单个 `<ActivityDock>`。
- [x] i18n:`dock.*`(plan/goal/retry/activity/collapse/expand/resize，双语）。
- [x] 验证:tsc + build。

## Phase 3 — 消息流 + Composer(D4 + D6)

- [x] `MessageList.tsx`:UserMessage 改右对齐气泡（max-w-75%,sage 淡色,
  时间戳在气泡下方右侧）;Agent 纯文档流;Thinking/Notice 更轻;gap-4→gap-3。
- [x] `ToolCallCard.tsx`：默认折叠单行更轻（去重边框，hover bg-accent/40,
  展开内容 bg-muted/30)。
- [x] `Composer.tsx`：卡片 rounded-xl，聚焦 sage 微光（reduced-motion 下无
  动画），底部工具行收进卡片内。
- [x] 验证:tsc + build。

## Phase 4 — Inspector + 左面板拖拽(D5 + D7)

- [x] `InspectorPanel.tsx`:Tabs 改分段控件式 h-8；内容区去多余内框。
- [x] `src/App.tsx`:`contextPanelWidth` state + ContextPanel 右侧挂
      `PanelResizeHandle`(200/240/320);Inspector 保持 280–480。
- [x] 验证 1100px 最小窗口下三栏布局不压坏。
- [x] 验证:tsc + build。

## Phase 5 — 全量验证 + 交付报告

- [x] `pnpm exec tsc --noEmit`、`pnpm build`、`pnpm vitest run`。
- [x] 双语 key 校验(en-US/zh-CN 对齐）。
- [x] 交付报告 + 用户手测清单(dark/light、宽/窄窗口、键盘、reduced-motion)。
- [x] 不 commit(仓库惯例：用户验收后再提交)。

## Phase 6 — 实时 Agent 回复与 Thinking 生命周期（D8 + D9）

- [x] 仅对当前 Session 新出现的 Agent Turn 启动，不重放历史消息。
- [x] 累计文本按字符前缀推进；streaming 每帧最多 6 字符、settling 每帧最多
      12 字符，使用 requestAnimationFrame + 28ms 节奏，避免大 delta 整块出现。
- [x] Markdown 不使用 deferred value 重新合并刻意分段的 reveal。
- [x] 回复操作延后到追赶完成；Session 替换与 reduced motion 安全清理。
- [x] Thinking 流式开始自动展开、结束自动收起，并保留手动 Disclosure。
- [x] 聚焦单测、typecheck、build 与真实 SDK Electron 实时回复流程通过。

## Phase 7 — Codex 式整轮结构与 Composer（完成）

- [x] 为 Renderer response group 增加有界 activity projection；Plan 使用已有
      `sourceEntryId`，Retry/Working/Status/Widget/notification 在到达时捕获
      scope/session/generation + 当前 `anchorEntryId`，无可靠 anchor 则进入全局通知。
- [x] `MessageList` 按 user-led response group 呈现 Agent 文档、Thinking、Tool、
      Change、Plan、Goal、Retry、提醒、完成摘要与 Copy/Fork；完成后压缩瞬时进度，
      保留 warning/error/actionable 状态。
- [x] 删除 `ActivityDock` 接线与组件；新增只在仍需操作时出现的紧凑
      `ActiveControlBar`；没有精确轮次锚点时不伪造展开动作。
- [x] 将 Composer 重构为统一输入壳，保留 typed `/`、typed `@`、附件、模型、Thinking、
      Enter/Ctrl+Enter、Queue/Steer/Run now、Stop/Send 与既有异步 revision/scope guard。
- [x] 删除 `StatusBar`；模型、分支/会话、Context/费用、Runtime、MCP、通知与更新按
      design D10 迁移到 Composer、ChatHeader、回复轮次、Integrations、ActivityRail。
- [x] 清理不再使用的 Dock/StatusBar locale、presenter 和组件；不得删除仍被 Header/
      Settings 使用的共享格式化逻辑。
- [x] focused unit：activity provenance、无 anchor 降级、settle 压缩、generation/session
      reset、Composer keyboard/IME/revision、ActivityRail 通知、无 StatusBar 布局。
- [x] 真实 Electron：新回复逐步输出、Thinking 生命周期、提醒归轮次、Session 切换无泄漏、
      `/`/`@`、Queue/Steer、dark/light、1100x680、无横向溢出；Plan/Retry 控制状态机由
      focused adapter/presentation 单测覆盖。
- [x] `pnpm typecheck`、focused Vitest、`pnpm build`、目标 Electron 与
      `git diff --check` 全部通过后再进入 Trellis check。

## Phase 8 — 最终验证（2026-08-18）

- [x] `pnpm exec vitest run tests/unit/live-typewriter.test.ts tests/unit/response-activity.test.ts tests/unit/pending-response-provenance.test.ts tests/unit/local-pi-rpc-renderer.test.ts`：4 files / 35 tests。
- [x] `pnpm test:unit`：61 files / 443 tests。
- [x] `pnpm typecheck` 与 `pnpm build`。
- [x] `pnpm exec playwright test --config=playwright.electron.config.ts tests/electron/composer-extension.electron.spec.ts tests/electron/pipilot.electron.spec.ts --grep "runs Composer|uses one keyboard-safe Composer picker"`：2/2 passed。
- [x] Electron 真实 Pi SDK 单大 chunk 回复先出现 `data-transcript-typing=true`，追赶完成后才显示完整正文与回复操作；settled activity 只保留最终摘要。
- [x] `pnpm test:electron`：11/11 passed；全量首次运行暴露 SDK Session 目录在 Runtime 存活期间被移除后无法继续持久化，补充命令分发前恢复不变量后全量复跑通过。
- [x] 独立 Trellis check：流式 Markdown 延迟语法高亮、相关动画补齐 reduced-motion，并用真实 SDK Electron 覆盖 Thinking 自动展开、结束收起和手动再展开；复验 unit 443/443、Electron 11/11。
- [x] `git diff --check`。

## 风险文件

- `src/App.tsx`（会话列结构、两个面板宽度）
- `src/components/chat/{ChatHeader,MessageList,Composer,ToolCallCard,ExtensionSurfaces}.tsx`
- `src/components/frame/{ActivityRail,GlobalNotifications}.tsx`、`src/components/inspector/InspectorPanel.tsx`
- `src/store/pi-rpc.tsx`、`src/renderer/pi-rpc/{presentation,projector}.ts`、`src/types/chat.ts`
- `src/i18n/locales/{en-US,zh-CN}.json`

## 回滚

文件级 `git checkout -- <path>`；工作区有大量无关脏文件，绝不 `git add -A` /
不 commit。
