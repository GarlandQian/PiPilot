import { describe, expect, it } from 'vitest'
import {
  formatContextPercent,
  formatSessionCost,
  formatTokenCount,
  formatTokenKilounits,
} from '../../src/renderer/pi-rpc/session-stats-format'

describe('official Pi session stats formatting', () => {
  it('keeps unavailable, zero, sub-cent, and ordinary costs distinct', () => {
    expect(formatSessionCost(null, 'en-US')).toBe('—')
    expect(formatSessionCost(0, 'en-US')).toBe('0.00')
    expect(formatSessionCost(0.0004, 'en-US')).toBe('0.0004')
    expect(formatSessionCost(0.125, 'en-US')).toBe('0.13')
    expect(formatSessionCost(0.125, 'en-US', true)).toBe('$0.125')
  })

  it('uses locale-aware compact and full token values', () => {
    expect(formatTokenCount(123_456, 'en-US')).toBe('123,456')
    expect(formatTokenKilounits(1_600, 'en-US')).toBe('1.6')
    expect(formatTokenKilounits(128_000, 'en-US')).toBe('128')
    expect(formatContextPercent(12.34, 'en-US')).toBe('12.3')
  })
})
