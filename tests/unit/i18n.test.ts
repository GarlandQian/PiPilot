import { describe, expect, it } from 'vitest'
import enUS from '../../src/i18n/locales/en-US.json'
import zhCN from '../../src/i18n/locales/zh-CN.json'

function placeholders(message: string) {
  return [...message.matchAll(/\{(\w+)\}/gu)]
    .map((match) => match[1])
    .sort()
}

describe('localized message catalogs', () => {
  it('keeps English and Chinese keys and interpolation contracts complete', () => {
    const englishKeys = Object.keys(enUS).sort()
    const chineseKeys = Object.keys(zhCN).sort()

    expect(chineseKeys).toEqual(englishKeys)
    for (const key of englishKeys) {
      const english = enUS[key as keyof typeof enUS]
      const chinese = zhCN[key as keyof typeof zhCN]
      expect(english.trim(), `${key} must have English text`).not.toBe('')
      expect(chinese.trim(), `${key} must have Chinese text`).not.toBe('')
      expect(placeholders(chinese), `${key} must use the same placeholders`)
        .toEqual(placeholders(english))
    }
  })
})
