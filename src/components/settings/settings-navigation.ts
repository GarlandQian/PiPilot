import type * as React from 'react'
import { TbBooks, TbClock, TbCpu, TbInfoCircle, TbPackage, TbPalette, TbPlugConnected, TbServer2, TbSettings, TbStack2, TbTerminal2 } from 'react-icons/tb'
import type { MessageKey } from '@/i18n'
import { SETTINGS_ROUTE_IDS, type SettingsRouteId } from '@/renderer/layout-preferences'

export type SettingsSectionId = SettingsRouteId
export type SettingsGroupId = 'preferences' | 'agent' | 'application'
export interface SettingsSectionMeta {
  id: SettingsSectionId
  labelKey: MessageKey
  descriptionKey: MessageKey
  icon: React.ComponentType<{ className?: string }>
  /** System Settings–style icon tile color. */
  tint: string
  searchTerms: string
}
export interface SettingsGroupMeta {
  id: SettingsGroupId
  labelKey: MessageKey
  sections: readonly SettingsSectionMeta[]
}
export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
  { id: 'preferences', labelKey: 'settings.group.preferences', sections: [
    { id: 'general', labelKey: 'settings.nav.general', descriptionKey: 'settings.redesign.general', icon: TbSettings, tint: '#8e8e93', searchTerms: 'send enter queue steer runtime Pi directory folder config locale language translation English Chinese notifications editor 发送 排队 引导 运行 目录 文件夹 配置 语言 简体中文 英文 通知 编辑器' },
    { id: 'appearance', labelKey: 'settings.nav.appearance', descriptionKey: 'settings.redesign.appearance', icon: TbPalette, tint: '#5e5ce6', searchTerms: 'theme font color size density wrap motion liquid glass transparency tint 字体 主题 颜色 密度 换行 动画 玻璃 透明 着色' },
    { id: 'terminal', labelKey: 'settings.nav.terminal', descriptionKey: 'settings.redesign.terminal', icon: TbTerminal2, tint: '#3a3a3c', searchTerms: 'shell profile zsh bash powershell wsl font size location panel external iTerm Ghostty 终端 外壳 配置 字体 位置 外部' },
  ] },
  { id: 'agent', labelKey: 'settings.redesign.agentGroup', sections: [
    { id: 'models', labelKey: 'settings.nav.models', descriptionKey: 'settings.redesign.models', icon: TbCpu, tint: '#ff9500', searchTerms: 'provider API endpoint key token model default thinking compaction retry 供应商 服务商 模型 接口 密钥 默认 思考 压缩 重试' },
    { id: 'mcp', labelKey: 'settings.nav.mcp', descriptionKey: 'settings.redesign.mcp', icon: TbServer2, tint: '#30b0c7', searchTerms: 'MCP server tools stdio http oauth import claude codex cursor 服务器 工具 导入' },
    { id: 'packages', labelKey: 'settings.nav.packages', descriptionKey: 'settings.redesign.packages', icon: TbPackage, tint: '#34c759', searchTerms: 'package extension plugin npm git install update 扩展包 插件 安装 更新' },
    { id: 'resources', labelKey: 'settings.nav.resources', descriptionKey: 'settings.redesign.resources', icon: TbBooks, tint: '#af52de', searchTerms: 'skill prompt extension theme resource 技能 提示词 资源 主题' },
    { id: 'local-environment', labelKey: 'settings.nav.localEnvironment', descriptionKey: 'settings.redesign.localEnvironment', icon: TbStack2, tint: '#007aff', searchTerms: 'local environment project actions commands setup dev test run worktree working copy branch archive 本地环境 项目操作 命令 运行 工作副本 分支 归档' },
    { id: 'scheduled-tasks', labelKey: 'scheduledTasks.title', descriptionKey: 'scheduledTasks.description', icon: TbClock, tint: '#ff3b30', searchTerms: 'schedule automation recurring 定时 计划 自动 重复 任务' },
  ] },
  { id: 'application', labelKey: 'settings.redesign.applicationGroup', sections: [
    { id: 'external-control', labelKey: 'settings.nav.externalControl', descriptionKey: 'settings.redesign.externalControl', icon: TbPlugConnected, tint: '#5856d6', searchTerms: 'external control MCP client launcher pipilot-mcp agent bridge 外部 控制 客户端 启动器' },
    { id: 'about', labelKey: 'settings.nav.about', descriptionKey: 'settings.redesign.about', icon: TbInfoCircle, tint: '#8e8e93', searchTerms: 'version updates release download credits acknowledgements license 版本 更新 发布 下载 致谢 许可' },
  ] },
]
const sections = new Map(SETTINGS_GROUPS.flatMap((group) => group.sections).map((section) => [section.id, section]))
export const SETTINGS_SECTIONS = SETTINGS_ROUTE_IDS.map((id) => sections.get(id)!)
export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return SETTINGS_ROUTE_IDS.some((route) => route === id)
}
