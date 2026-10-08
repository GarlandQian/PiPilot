import type * as React from 'react'
import { TbClock, TbCpu, TbInfoCircle, TbPalette, TbPuzzle, TbSettings, TbTerminal2, TbWorld } from 'react-icons/tb'
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
    { id: 'general', labelKey: 'settings.nav.general', descriptionKey: 'settings.redesign.general', icon: TbSettings, tint: '#8e8e93', searchTerms: 'send enter queue steer runtime Pi directory folder config 发送 排队 引导 运行 目录 文件夹 配置' },
    { id: 'appearance', labelKey: 'settings.nav.appearance', descriptionKey: 'settings.redesign.appearance', icon: TbPalette, tint: '#5e5ce6', searchTerms: 'theme font color size density wrap motion liquid glass transparency tint 字体 主题 颜色 密度 换行 动画 玻璃 透明 着色' },
    { id: 'language', labelKey: 'settings.nav.language', descriptionKey: 'settings.redesign.language', icon: TbWorld, tint: '#007aff', searchTerms: 'locale translation English Chinese 简体中文 英文 语言' },
    { id: 'terminal', labelKey: 'settings.nav.terminal', descriptionKey: 'settings.redesign.terminal', icon: TbTerminal2, tint: '#3a3a3c', searchTerms: 'shell font size 终端 字体' },
  ] },
  { id: 'agent', labelKey: 'settings.redesign.agentGroup', sections: [
    { id: 'models', labelKey: 'settings.nav.models', descriptionKey: 'settings.redesign.models', icon: TbCpu, tint: '#ff9500', searchTerms: 'provider API endpoint key token model 供应商 模型 接口 密钥' },
    { id: 'integrations', labelKey: 'settings.nav.integrations', descriptionKey: 'settings.redesign.integrations', icon: TbPuzzle, tint: '#34c759', searchTerms: 'package skill extension MCP plugin external control launcher 插件 扩展 技能 包 控制 启动器' },
    { id: 'scheduled-tasks', labelKey: 'scheduledTasks.title', descriptionKey: 'scheduledTasks.description', icon: TbClock, tint: '#ff3b30', searchTerms: 'schedule automation recurring 定时 计划 自动 重复 任务' },
  ] },
  { id: 'application', labelKey: 'settings.redesign.applicationGroup', sections: [
    { id: 'about', labelKey: 'settings.nav.about', descriptionKey: 'settings.redesign.about', icon: TbInfoCircle, tint: '#8e8e93', searchTerms: 'version updates release download 版本 更新 发布 下载' },
  ] },
]
const sections = new Map(SETTINGS_GROUPS.flatMap((group) => group.sections).map((section) => [section.id, section]))
export const SETTINGS_SECTIONS = SETTINGS_ROUTE_IDS.map((id) => sections.get(id)!)
export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return SETTINGS_ROUTE_IDS.some((route) => route === id)
}
