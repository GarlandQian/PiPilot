import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS, presetForProvider, searchProviderPresets } from '../../src/shared/model-provider-presets'

const iconSource = readFileSync(join(__dirname, '../../src/components/settings/models/ProviderIcon.tsx'), 'utf8')

describe('provider presets', () => {
  it('have unique keys, working addresses and logos that exist', () => {
    const keys = PROVIDER_PRESETS.flatMap((preset) => [preset.key, ...preset.versions.map((version) => `${preset.key}/${version.key}`)])
    expect(new Set(keys).size).toBe(keys.length)
    for (const preset of PROVIDER_PRESETS) {
      for (const version of preset.versions) {
        for (const url of [version.apiKeyUrl, version.kind === 'custom' && version.baseUrl ? version.baseUrl : undefined].filter(Boolean)) {
          expect(() => new URL(url!), url).not.toThrow()
          // Referral and tracking parameters stay out.
          expect(url, url).not.toMatch(/aff=|utm_|invite|track_id|[?&]ref=/iu)
        }
      }
      if (preset.icon) {
        expect(existsSync(join(__dirname, `../../node_modules/@lobehub/icons-static-svg/icons/${preset.icon}.svg`)), preset.icon).toBe(true)
        expect(iconSource, preset.icon).toContain(`'${preset.icon}'`.replace(/^'([a-z]+)'$/u, '$1'))
      }
    }
  })

  it('finds a company by its Chinese or English name, alias, domain or Pi provider ID', () => {
    const keys = (query: string, category?: Parameters<typeof searchProviderPresets>[2]) => searchProviderPresets(PROVIDER_PRESETS, query, category).map((preset) => preset.key)
    expect(keys('硅基')).toEqual(['siliconflow'])
    expect(keys('kimi')).toEqual(['kimi'])
    expect(keys('moonshotai-cn')).toEqual(['kimi'])
    expect(keys('dashscope.aliyuncs.com')).toEqual(['qwen'])
    expect(keys('', 'local')).toEqual(['ollama', 'lmstudio'])
    expect(keys('nothing-like-this')).toEqual([])
  })

  it('recognises where a configured provider came from', () => {
    expect(presetForProvider({ id: 'moonshotai-cn', builtin: true })).toMatchObject({ preset: { key: 'kimi' }, version: { key: 'moonshotai-cn' }, exact: true })
    expect(presetForProvider({ id: 'my-sf', baseUrl: 'https://api.siliconflow.cn/v1/' })).toMatchObject({ preset: { key: 'siliconflow' }, exact: true })
    // Another address of the same company: its logo and name, not its settings.
    expect(presetForProvider({ id: 'ds', baseUrl: 'https://api.deepseek.com/beta' }, { deepseek: 'https://api.deepseek.com' })).toMatchObject({ preset: { key: 'deepseek' }, exact: false })
    expect(presetForProvider({ id: 'local', baseUrl: 'http://localhost:8000/v1' })).toBeNull()
  })
})
