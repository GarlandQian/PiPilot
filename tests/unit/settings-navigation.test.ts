import { describe, expect, it } from 'vitest'
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  isSettingsSectionId,
} from '../../src/components/settings/SettingsLayout'
import { SETTINGS_ROUTE_IDS } from '../../src/renderer/layout-preferences'

describe('settings navigation metadata', () => {
  it('groups every settings route without changing its flat route contract', () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual([
      'preferences',
      'models-runtime',
      'packages-mcp',
      'about',
    ])

    const groupedIds = SETTINGS_GROUPS.flatMap((group) => (
      group.sections.map((section) => section.id)
    ))
    expect(new Set(groupedIds)).toEqual(new Set(SETTINGS_ROUTE_IDS))
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([...SETTINGS_ROUTE_IDS])
    expect(new Set(groupedIds).size).toBe(groupedIds.length)
  })

  it('accepts only the supported settings route IDs', () => {
    for (const id of SETTINGS_ROUTE_IDS) expect(isSettingsSectionId(id)).toBe(true)
    expect(isSettingsSectionId('workspace')).toBe(false)
    expect(isSettingsSectionId('missing')).toBe(false)
  })
})
