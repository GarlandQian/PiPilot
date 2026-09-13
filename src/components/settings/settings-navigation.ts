import type * as React from 'react'
import { TbAdjustmentsHorizontal, TbCpu, TbInfoCircle, TbLanguage, TbPackages, TbPalette, TbTerminal2 } from 'react-icons/tb'
import type { MessageKey } from '@/i18n'
import { SETTINGS_ROUTE_IDS, type SettingsRouteId } from '@/renderer/layout-preferences'

export type SettingsSectionId = SettingsRouteId
export type SettingsGroupId = 'preferences' | 'agent' | 'application'
export interface SettingsSectionMeta {
  id: SettingsSectionId
  labelKey: MessageKey
  descriptionKey: MessageKey
  icon: React.ComponentType<{ className?: string }>
  searchTerms: string
}
export interface SettingsGroupMeta {
  id: SettingsGroupId
  labelKey: MessageKey
  sections: readonly SettingsSectionMeta[]
}
export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
  { id: 'preferences', labelKey: 'settings.group.preferences', sections: [
    { id: 'general', labelKey: 'settings.nav.general', descriptionKey: 'settings.redesign.general', icon: TbAdjustmentsHorizontal, searchTerms: 'send enter queue steer runtime Pi 发送 排队 引导 运行' },
    { id: 'appearance', labelKey: 'settings.nav.appearance', descriptionKey: 'settings.redesign.appearance', icon: TbPalette, searchTerms: 'theme font color size density wrap motion 字体 主题 颜色 密度 换行 动画' },
    { id: 'language', labelKey: 'settings.nav.language', descriptionKey: 'settings.redesign.language', icon: TbLanguage, searchTerms: 'locale translation English Chinese 简体中文 英文 语言' },
    { id: 'terminal', labelKey: 'settings.nav.terminal', descriptionKey: 'settings.redesign.terminal', icon: TbTerminal2, searchTerms: 'shell font size 终端 字体' },
  ] },
  { id: 'agent', labelKey: 'settings.redesign.agentGroup', sections: [
    { id: 'models', labelKey: 'settings.nav.models', descriptionKey: 'settings.redesign.models', icon: TbCpu, searchTerms: 'provider API endpoint key token model 供应商 模型 接口 密钥' },
    { id: 'integrations', labelKey: 'settings.nav.integrations', descriptionKey: 'settings.redesign.integrations', icon: TbPackages, searchTerms: 'package skill extension MCP plugin external control launcher 插件 扩展 技能 包 控制 启动器' },
  ] },
  { id: 'application', labelKey: 'settings.redesign.applicationGroup', sections: [
    { id: 'about', labelKey: 'settings.nav.about', descriptionKey: 'settings.redesign.about', icon: TbInfoCircle, searchTerms: 'version updates release download 版本 更新 发布 下载' },
  ] },
]
const sections = new Map(SETTINGS_GROUPS.flatMap((group) => group.sections).map((section) => [section.id, section]))
export const SETTINGS_SECTIONS = SETTINGS_ROUTE_IDS.map((id) => sections.get(id)!)
export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return SETTINGS_ROUTE_IDS.some((route) => route === id)
}
