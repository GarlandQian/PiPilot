import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppProtocolPath } from '../../src/main/security/app-protocol-path'
import { createApplicationUrlPolicy } from '../../src/main/security/url-policy'

describe('application URL policy', () => {
  it('trusts only the exact loopback development origin', () => {
    const policy = createApplicationUrlPolicy('http://127.0.0.1:3000/')

    expect(policy.isTrustedRendererUrl('http://127.0.0.1:3000/')).toBe(true)
    expect(policy.isTrustedRendererUrl('http://127.0.0.1:3000/settings')).toBe(true)
    expect(policy.isTrustedRendererUrl('http://127.0.0.1.evil:3000/')).toBe(false)
    expect(policy.isTrustedRendererUrl('https://127.0.0.1:3000/')).toBe(false)
  })

  it('rejects non-loopback development URLs at startup', () => {
    expect(() => createApplicationUrlPolicy('https://example.com/')).toThrow()
    expect(() => createApplicationUrlPolicy('http://user@localhost:3000/')).toThrow()
  })

  it('trusts only the production application scheme and host', () => {
    const policy = createApplicationUrlPolicy()

    expect(policy.isTrustedRendererUrl('pipilot://app/')).toBe(true)
    expect(policy.isTrustedRendererUrl('pipilot://app/assets/index.js')).toBe(true)
    expect(policy.isTrustedRendererUrl('pipilot://attacker/')).toBe(false)
    expect(policy.isTrustedRendererUrl('file:///tmp/index.html')).toBe(false)
  })

  it('allows only credential-free HTTP and HTTPS external URLs', () => {
    const policy = createApplicationUrlPolicy()

    expect(policy.isSafeExternalUrl('https://example.com/docs')).toBe(true)
    expect(policy.isSafeExternalUrl('http://localhost:8080/')).toBe(true)
    expect(policy.isSafeExternalUrl('https://user@example.com/')).toBe(false)
    expect(policy.isSafeExternalUrl('file:///tmp/secret')).toBe(false)
    expect(policy.isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('application protocol path resolution', () => {
  const rendererRoot = resolve('/app', 'out', 'renderer')

  it('maps the root and assets inside the renderer directory', () => {
    expect(resolveAppProtocolPath(rendererRoot, 'pipilot://app/')).toBe(
      resolve(rendererRoot, 'index.html'),
    )
    expect(resolveAppProtocolPath(rendererRoot, 'pipilot://app/assets/app.js?v=1')).toBe(
      resolve(rendererRoot, 'assets', 'app.js'),
    )
  })

  it('rejects host confusion, malformed escapes, traversal, and backslashes', () => {
    expect(resolveAppProtocolPath(rendererRoot, 'pipilot://evil/index.html')).toBeNull()
    expect(resolveAppProtocolPath(rendererRoot, 'pipilot://app/%E0%A4%A')).toBeNull()
    expect(resolveAppProtocolPath(rendererRoot, 'pipilot://app/%2e%2e/secret')).toBeNull()
    expect(resolveAppProtocolPath(rendererRoot, 'pipilot://app/assets\\..\\secret')).toBeNull()
  })
})
