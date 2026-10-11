import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: class {}, session: {}, shell: {} }))
const { browserAddress } = await import('../../src/main/browser/browser-pane-service')

describe('browser address bar', () => {
  it('opens local dev servers over http and other hosts over https', () => {
    expect(browserAddress('localhost:5173')).toBe('http://localhost:5173/')
    expect(browserAddress('0.0.0.0:3000/app')).toBe('http://localhost:3000/app')
    expect(browserAddress('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/')
    expect(browserAddress('example.com/docs')).toBe('https://example.com/docs')
    expect(browserAddress('https://pi.dev')).toBe('https://pi.dev/')
  })

  it('searches for words and refuses other schemes', () => {
    expect(browserAddress('vite config')).toBe('https://duckduckgo.com/?q=vite%20config')
    expect(() => browserAddress('file:///etc/passwd')).toThrow('Only web addresses')
    expect(() => browserAddress('javascript:alert(1)')).toThrow('Only web addresses')
    expect(() => browserAddress('  ')).toThrow('Enter an address')
  })
})
