# 设计 — 会话主界面重新设计（Codex 式整轮文档流 + 统一输入面）

## 方向确认

用户选定完整中间会话列重做：复用 Codex 成熟的整轮信息层级、实时反馈节奏、
Composer 结构和提醒归属，但保留 PiPilot 的中性灰 + sage、现有 Token、Tabler 图标
和真实 Pi 能力。原“统一底部 Dock”方向被后续决定取代，不再保留。

## 架构约束

- 纯渲染层重构：不改 Pi RPC / IPC / shared 契约 / pi-host。
- 不新增第三方依赖；复用 `src/components/ui/*` 原语与现有 CSS token。
- 保持 sage 主色、dark/light 双主题、紧凑密度、reduced-motion、键盘可达。
- 消息列继续保持 `max-w-[920px]` 居中单列（可读性锚点）;Composer 与之对齐。

## D1 顶部栏（Codex 式极简单行）

替换 `ChatHeader`(h-11 大标题栏）为 **h-8(32px）细行**:

```
[图标] [标题(截断)]                    [···菜单] [Inspector开关]
```

- 左侧：TbMessageCircle 类小图标（size-3.5,muted)+ 标题 `text-caption font-medium`
  单行截断（不再是 text-title 大标题）。
- 右侧：`···` 溢出菜单（压缩会话等动作收进去）+ Inspector 开关 icon-sm。
- 视觉：`bg-background`,hairline `border-b border-border/60`；不再有独立的
  `bg-surface` 高条。
- i18n 复用现有 `header.*` key。

## D2 通知与提醒按所有权分流

- 能在事件到达时证明属于当前 scope/session/generation 且能取得当前用户轮次
  `anchorEntryId` 的通知、Working、Retry、Status、Widget 和扩展错误，记录为该轮的
  activity item，交给 MessageList 呈现。
- Plan 已有 `sourceEntryId`，继续走权威投影；其他临时 Extension UI surface 在 Renderer
  接收时捕获 provenance，不修改 Pi SDK / Host 协议，也不在事后按时间猜测。
- 正常瞬时进度在 agent settled 后压缩为最后一条权威结算摘要，不伪造上游未提供的
  耗时；warning/error、
  actionable Plan/Goal/Retry 控件以及用户主动展开的详情保留。
- 无 `anchorEntryId`、发生在 idle 状态或属于应用级的更新/插件故障进入 ActivityRail
  底部通知按钮与 Popover；切换 generation/session 立即清除旧的未落轮次状态。
- 删除会话列顶部常驻 `ExtensionNotifications` 与 `ApplicationUpdateNotice`。

## D3 回复轮次活动 + Composer 上方紧凑控制条

删除 `ActivityDock` 及其 Plan / Goal / Retry / Activity tabs。兼容层按所有权拆成
两部分：

```
回复轮次：Thinking → Agent 文本 → Tool/Change/Plan/Goal/Retry/提醒 → 轮次摘要与动作
Composer 上方：[当前仍需操作的状态摘要] [主要动作] [展开]
```

- 对应回复轮次内使用统一的 activity row/disclosure，不为每个插件保留独立大卡片；
  通用插件走同一个 fallback presenter，包级 Adapter 只提供额外字段与动作。
- Composer 上方只显示当前仍需要用户操作或持续关注的一个紧凑条，例如停止 Retry、
  实施 Plan、继续 Goal；无 active control 时完全不占高度。
- 紧凑条不是历史来源。状态 settle 后必须进入对应回复轮次或消失，不能留下一份重复
  内容；只有同一状态携带精确轮次锚点时才允许提供“展开”并滚动到权威详情，否则不
  渲染该动作。
- 所有动作沿用现有官方 Pi command/adapter callback；未知插件只展示经过边界限制的
  文本，不生成推测性按钮。

## D4 消息流重设计

- 以一次 user-led response 为视觉单元，而不是逐消息平铺。用户输入仍为右对齐 sage
  气泡；Agent 是无框 Markdown 文档流。
- Thinking、Tool、文件变更、Plan、Goal、Retry、Extension Activity 和 reminder 都
  归入其 response group；相邻活动用紧凑行/Disclosure 聚合，避免同一轮出现多张卡。
- Tool 默认只显示图标、命令/文件、状态与短摘要；详情展开后才渲染 arguments/output。
  文件修改优先聚合为 Codex 式 change summary，再按文件展开，而不是重复工具卡。
- 回复完成后显示一条紧凑权威状态与操作行（仅使用上游真实元信息 + Copy/Fork 等
  真实动作）；流式
  追赶未完成时隐藏动作，错误/中止在同一位置给出可读状态。
- 历史 Turn 立即完整渲染；只有当前新 response 使用打字机追赶和自动 Thinking 生命周期。

## D5 Inspector 重设计

- 顶部 Tabs 从 line 变体改为 **分段控件式**（圆角 bg-muted 容器，激活段
  bg-background 小圆角）,h-8。
- 文件树/Diff 行高、图标、状态点沿用，去掉内容区多余嵌套边框
  （`rounded-md border` 内框改为无外框直接填充）。
- 侧栏整体 `bg-sidebar` 保持；底部不再有大块留白。

## D6 Composer 重设计

- 与消息列同宽，使用一个 Codex 式统一输入壳：附件/引用在上、可增长正文在中、操作行
  在下；不再由多个相邻边框面板拼接。
- 左侧保留真实附件入口；`/` 直接打开 Commands + Skills，`@` 直接打开 Files +
  Skills，二者复用同宽候选面，不恢复单独 `@` 按钮。
- 模型、Thinking、发送行为（Enter 或 Ctrl+Enter）、Queue/Steer/Run now、Stop 与发送
  收进稳定的底部操作行；低频选项进入菜单，不挤压正文。
- 不复制 Codex 麦克风等 PiPilot 尚不存在的功能。所有 icon-only 按钮使用现有
  `react-icons/tb`、Tooltip 与本地化 `aria-label`。
- 输入壳下方只保留单行低干扰免责声明；运行提醒不放在这里，而按 D2/D3 进入当前
  回复轮次或 active-control 条。
- 统一使用现有 `bg-card` / `border-input` / sage focus ring 与紧凑尺寸；1100x680、
  中英文长文案、图片附件和 picker 展开时不得产生页面级横向滚动。

## D7 左右面板均可拖拽

- `ContextPanel` 新增右侧 `PanelResizeHandle`:min 200 / default 240 / max 320。
- `Inspector` 保持现有 280–480 拖拽。
- 宽度状态放 App.tsx(`contextPanelWidth` state)，不持久化（保持会话内即可，
  如后续需要再入 settings)。
- 主内容区 `min-w-0 flex-1` 已被压缩保护；窗口 min-width 1100px 不变。

## D8 实时回复打字机显现

- Session hydration 的历史 Turn 仍直接显示；只对同一 Session ready 后新出现的
  Agent Turn 启动打字机，避免每次打开历史都重放动画。
- Pi 投影的累计 markdown 始终是权威 target。Renderer 每 24ms 从已显示前缀向
  target 推进；小 backlog 逐字符，大 backlog 自适应加速，stream settled 后加速
  收尾，既保持打字感也不让长回复拖延数分钟。
- 累计文本发生修正时退回双方共同前缀后继续推进，不拼接或猜测内容。
- 当前 Agent 的 Copy/Fork 操作等到文字追赶完成后出现；Tool、状态和真实 Runtime
  生命周期不被动画阻塞。
- Session/generation 替换会卸载旧计时器；`prefers-reduced-motion` 或应用 reduced
  motion 设置启用时直接显示权威全文。

## D9 Thinking 生命周期 Disclosure

- Thinking Turn 首次以 `streaming` 状态挂载时默认展开；同一 Turn 从非流式进入
  流式时也自动展开。
- 用户可在输出期间手动折叠；当 `streaming` 结束时无条件收起，之后仍可手动
  展开检查完整思考内容。
- 使用原生 button、`aria-expanded` 与 `aria-controls`，不新增浮层或额外状态栏。

## D10 删除 StatusBar 并重新分配信息

彻底删除 `StatusBar` 常驻底栏，不做换皮版本。原内容按所有权迁移：

| 原 StatusBar 内容 | 新归属 |
| --- | --- |
| Model | Composer 现有模型选择器 |
| Branch / Session | ChatHeader 的标题与详情 Popover |
| Context usage / Cost | ChatHeader 详情 Popover；无数据时不占位 |
| Runtime state | 正常 ready 不显示；starting/running 属于当前轮次，crashed/error 就近提示 |
| MCP state | Integrations → MCP；只有异常进入全局通知 |
| Extension notifications | 有轮次归属进入该轮；否则进入 ActivityRail 通知入口 |
| Application update | ActivityRail 通知入口，并可跳转 About/更新详情 |

- ActivityRail 底部在 Command Palette 上方增加 `TbBell` icon-only 按钮；未读使用小状态点
  和可访问计数，不新增顶级导航目的地。
- Popover 沿用紧凑列表、severity、dismiss 和跳转动作；打开后不自动吞掉错误，只有
  明确 dismiss/处理才移除。
- 删除 `StatusBar.tsx` 及仅为它服务的 model/branch/context/cost/MCP presenter；共享格式化
  helper 若仍被 ChatHeader 使用则保留，不复制计算逻辑。
- App 主区域延伸到窗口底边；Composer 自身负责底部安全间距，Terminal/Inspector resize
  不依赖 26px footer 偏移。

## 布局结果（会话列，自上而下）

```
D1 细标题行 h-8
MessageList(flex-1，D4 response groups + per-turn activity)
D3 ActiveControlBar(仅仍需操作时出现)
D6 Unified Composer
```

只有能归属回复轮次的提醒进入 MessageList；全局通知进入 ActivityRail。窗口无常驻底栏。

## i18n

删除不再使用的 `dock.*` 与 `statusbar.*` key；新增 response activity、完成摘要、展开
详情、active control、ActivityRail 通知和 Composer 辅助文案所需 key（双语，en-US 为
类型源）。尽量复用现有 Plan/Goal/Retry/Tool/notification 文案，不硬编码插件名称或状态。

## 风险

- Extension UI request 当前没有 entry ID；Renderer 只能在事件到达时用权威
  session/generation + 当前 response anchor 绑定。无 anchor 必须进入 ActivityRail
  全局通知，不能按时间猜测后补。
- Goal/Retry/Widget 的持续状态与历史 activity 容易重复；ActiveControlBar 必须只引用
  当前 activity identity，settle 后由轮次摘要接管。
- 打字机效果不能逐字符重新跑昂贵 Markdown/代码高亮；需要保留累计目标、帧预算和
  backlog 自适应，并在 reduced motion 下直出。
- 用户消息改右对齐气泡是明显的视觉变化，验收时重点看长消息/窄窗口表现。
- D7 左面板拖拽影响 ActivityRail 之外的整行布局，需验证 1100px 最小宽度下
  三栏不被压坏。
- 删除 StatusBar 可能暴露依赖其高度的布局假设；必须覆盖 Terminal、Inspector、设置页、
  空会话、加载会话和 Composer picker 打开状态的窗口底边与滚动边界。

## 验收（与 PRD 对齐）

1. 顶部为 Codex 式极简单行，无大标题栏。
2. 可归属提醒出现在对应回复轮次；全局通知由 ActivityRail Popover 可读可关。
3. 不存在 ActivityDock 或多个插件卡；Composer 上方最多一个按需出现的紧凑控制条。
4. 用户消息右对齐气泡；Agent 为文档流；工具、变更、Plan/Goal/Retry/提醒在同一轮
   形成紧凑活动结构。
5. 左 ContextPanel(200-320）与右 Inspector(280-480）均可拖拽。
6. dark/light 两主题、reduced-motion、键盘操作全部可用。
7. `pnpm exec tsc --noEmit` + `pnpm build` 通过；不引入新依赖。
8. 同一 Session 的新 Agent 回复渐进追赶权威文本，历史消息不重放。
9. Thinking 流式开始自动展开，结束自动收起，且可手动检查已完成内容。
10. Composer 是单一统一输入壳；`/`、`@`、附件、模型、发送模式、Queue/Steer、
    Stop 与发送均保留真实行为和键盘可达性。
11. Session/generation 切换不会显示上一会话的 activity、提醒或 active control。
12. StatusBar 完全移除，Model/Branch/Context/Cost/Runtime/MCP/通知/更新均按 D10 找到唯一
    新归属；窗口底边没有空白、遮挡或滚动回归。
