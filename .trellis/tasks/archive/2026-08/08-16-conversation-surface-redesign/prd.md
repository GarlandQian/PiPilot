# 会话主界面重新设计（Conversation Surface Redesign)

## 背景

用户在 2026-08-16 对当前会话主界面提出整体不满，截图圈出四大区域并明确表示"全都不满意、非常难看"，要求"不要管之前的，重新设计，要有创新"。

本任务独立于 08-14 pi-plugin-lag-refactor（后端重构，后者仍在等待用户验收）。

2026-08-18，用户进一步要求“中间的效果和 Codex 的一样，抄一下他的”，并确认
范围不是只调整实时生成动画，而是重做完整中间会话列；随后补充要求底部输入框与
提醒也采用同一套 Codex 式交互规律，并明确 Composer 上方的插件兼容层也要重写，
不能只更换现有 Dock/卡片外壳。用户同时明确认为现有 StatusBar 很难看，需决定
整体删除还是重新设计。PiPilot 必须复用 Codex 的成熟信息层级、状态
节奏和操作位置，而不是复制 Codex 品牌、专有图标、文案或像素样式；最终视觉仍遵守
PiPilot 已确认的中性灰 + sage、紧凑桌面工具语言，并保留 PiPilot 实际支持的 Pi
命令、模型、Queue、Steer、附件、`/` 与 `@` 能力，不伪造语音等不存在的功能。

## 用户明确指出的问题（截图圈注 + 文字）

1. **ChatHeader 标题栏** — 圈注，不满意。
2. **MessageList 消息区** — 圈注整片消息流，不满意。
3. **Inspector 右栏** — 圈注，不满意。
4. **Composer 底部输入区** — 圈注，不满意。
5. **顶部通知条**(ExtensionNotifications，位于 ChatHeader 下的内联横幅）— 不满意。
6. **底部插件适配面**(PlanActivityBlock / GoalActivityBlock / ExtensionActivityStrip / RetryActivityBlock 堆叠在消息区与 Composer 之间）— 不满意。
7. **面板拖拽** — "中间的左侧和右侧应该都能拉伸，现在只有右侧可以":ContextPanel 固定 240px，只有 Inspector 可拖（280–480px)。要求左右两侧都可拖拽调整。

## 现状证据（代码确认）

- `src/App.tsx:88-90,162,825-838`:`INSPECTOR_MIN/MAX/DEFAULT = 280/480/360`,`PanelResizeHandle` 仅挂在 Inspector 左侧；`ContextPanel` 宽度固定（`src/components/frame/ContextPanel.tsx`,240px)。
- `src/components/chat/ChatHeader.tsx`:h-11 标题 + 菜单 + Inspector 开关，纯文本标题。
- `src/App.tsx:716-800`：会话列自上而下 ChatHeader → ExtensionNotifications → ApplicationUpdateNotice → MessageList → PlanActivityBlock → GoalActivityBlock → ExtensionActivityStrip → RetryActivityBlock → Composer，最多叠加 4 个插件块 + 通知条。
- `src/components/chat/MessageList.tsx:502`、Composer.tsx:1040：内容与输入均 max-w-[920px] 居中。
- `src/components/chat/ExtensionSurfaces.tsx`:ExtensionNotifications（顶部内联条，border-l-2 分类色）、ExtensionActivityStrip（可折叠卡片，mono micro 文本）、Retry/Plan/Goal 块均为 border 卡片式。
- `src/components/chat/MessageList.tsx` 与
  `src/renderer/pi-rpc/live-typewriter.ts` 已实现仅对当前执行中新 Agent Turn 的累计文本
  追赶、历史消息立即显示、reduced-motion 直出、回复操作延后显示。
- `src/components/chat/MessageList.tsx` 的 Thinking Disclosure 已实现流式开始展开、
  结束收起，并允许用户手动切换。
- 当前用户消息为右对齐 sage 气泡，Agent 为无框 Markdown；Tool Call 仍逐条使用
  `ToolCallCard`，回复尾部只有 Copy / Fork。是否进一步引入 Codex 式紧凑活动行、
  文件变更摘要和整轮回复分组，属于本轮待确认的产品范围。

## 已确认方向

**方向 A:文档流 + 统一底部 Dock**;顶部参考 Codex 极简单行（用户供图:
小图标 + 截断标题 + `···` 菜单，无大标题栏）。详见 design.md D1-D7。

## 需求

- R1 顶部栏改 Codex 式 h-8 极简单行（图标+截断标题+溢出菜单+Inspector 开关）。
- R2 顶部常驻通知横幅移除。能可靠归属回复轮次的通知进入该轮；无归属的全局
  通知与应用更新进入 ActivityRail 的通知 Popover。
- R3 Plan/Goal/Retry/Activity 不再形成底部卡片或 Dock。历史状态进入对应回复轮次；
  只有当前仍可操作的状态在 Composer 上方使用一个紧凑 ActiveControlBar。
- R4 左 ContextPanel(200-320）与右 Inspector(280-480）均可拖拽调宽。
- R5 消息流重设计：用户消息右对齐气泡、Agent 纯文档流、工具卡更轻。
- R6 Composer 与消息列对齐，聚焦 sage 微光，工具行收进卡片内。
- R7 Inspector Tabs 改分段控件式，去内容区多余内框。
- R8 保持 dark/light 双主题、sage 主色、紧凑密度、键盘可达性、reduced-motion。
- R9 不改变 Pi RPC / IPC / shared 契约 / pi-host；不新增第三方依赖。
- R10 Agent 正在执行时，新到达的回复文字使用自适应打字机效果平滑追赶 Pi 的
  权威累计文本，即使 SDK 一次推送较大文本或最终一次性返回也不能整段闪现。
  历史 Session 不重放；reduced motion 直接完整显示。
- R11 Thinking 内容在流式输出开始时自动展开，输出结束后自动收起；用户仍可
  手动折叠正在输出的内容或展开已完成的内容。
- R12 中间会话列按 Codex 式整轮结构重做：用户输入、Agent 文档流、Thinking、
  工具活动、文件变更摘要、执行状态/耗时与回复尾部动作形成清晰的单轮信息层级；
  不重复显示同一状态，不把每种扩展能力都做成独立大卡片。
- R13 Composer 改为 Codex 式紧凑、贴近内容列的统一输入面：输入正文为主体，附件、
  `/` Commands + Skills、`@` Files + Skills、模型、Queue/Steer/立即运行、Stop 与发送
  继续使用现有真实能力和既有键盘语义；控件保持稳定尺寸，最小窗口下不横向溢出。
- R14 能可靠归属到当前回复轮次的提醒、错误、重试、Working 状态、Widget 与扩展
  通知进入对应回复轮次，不再出现在 Composer 周边或顶部横幅。正常瞬时进度在轮次
  完成后压缩为一行摘要；警告、错误和仍可操作内容保留。无法证明轮次归属的应用更新、
  全局插件故障等继续进入 ActivityRail 通知入口，Renderer 不猜测归属。
- R15 Composer 上方兼容层重写信息架构与交互，不保留 Plan / Goal / Retry /
  Extension Activity 各自堆叠大卡片的形态。插件输出必须按当前会话、当前执行轮次和
  持续控制需求分层；通用桥接信息使用统一呈现，只有确有专用能力的 Adapter 才增加
  专属控制，未知插件仍能以安全、可读的通用状态降级。
- R16 现有 StatusBar 不得原样保留。推荐直接删除常驻底栏：模型归 Composer，
  分支/会话归 Header，Context/费用归 Header 详情，全局通知/应用更新迁到
  ActivityRail 底部入口，Runtime/MCP 只在异常或相关设置界面出现。用户已采用。

## 验收标准

1. 顶部为 Codex 式极简单行，无 h-11 大标题栏。
2. 会话列无常驻通知横幅；无归属通知由 ActivityRail Popover 可逐条处理。
3. 不存在 ActivityDock 或多个插件卡；Composer 上方最多一个按需出现的紧凑控制条。
4. 用户消息右对齐气泡；工具卡默认折叠单行；不再有多卡片堆叠。
5. 左右面板均可拖拽，1100px 最小窗口下布局不压坏。
6. dark/light、reduced-motion、键盘操作全部可用。
7. `pnpm exec tsc --noEmit` 与 `pnpm build` 通过；无新依赖。
8. 新执行产生的 Agent 回复逐步显现，完成后内容与 Pi 权威文本完全一致；历史
   消息立即显示，回复操作在文字追赶完成后出现，reduced motion 下无动画。
9. Thinking 流式输出时默认展开，结束后自动收起，Disclosure 保持键盘与
   `aria-expanded` / `aria-controls` 语义。
10. 完整会话轮次与 Composer 采用一致的 Codex 式信息层级，但颜色、字体、Token、
    图标族和组件形态仍属于 PiPilot；不出现第二套视觉体系。
11. Composer 保留全部当前可用 PiPilot 能力，`/` 与 `@` 候选、Queue/Steer、Stop、
    附件和模型选择均可键盘操作，1100x680 下无页面级横向滚动。
12. Composer 上方不再出现多个插件兼容卡片；同一执行轮次的进度归入消息流，只有
    仍需持续查看或操作的状态才占用 Composer 上方的紧凑区域。
13. 对应回复轮次内能看到该轮产生的提醒与扩展状态；切换 Session/generation 后不
    泄漏到新会话。完成后的普通进度只保留紧凑摘要，错误与操作入口不会静默消失。
14. 不再渲染常驻 StatusBar；原有信息在新的归属位置可找到且不重复。ActivityRail
    全局通知入口支持未读/严重级别、键盘访问和逐条处理。

## Out of scope

- 后端、IPC、shared 契约、pi-host 相关改动。
- ActivityRail / CommandPalette 的整体重设计；ActivityRail 只增加既定的通知入口。
- 新增第三方 UI 库依赖。
- 宽度持久化到 settings（会话内 state 即可）。

## 关键决定

- 方向 A（用户从三个候选中选定）;顶部样式参考 Codex 截图（用户提供）。
- 可归属的扩展与运行状态进入回复轮次；持续操作由单一 ActiveControlBar 承载。
- StatusBar 与 ActivityDock 删除，不保留兼容外壳。

## 当前状态

- 完整中间列、Composer、兼容层、提醒归属与 StatusBar 删除均已确认并进入实现；
  当前只剩真实 Electron 与独立质量门验收。
