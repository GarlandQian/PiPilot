import { describe, expect, it } from 'vitest'
import { safePiManagementMessage } from '../../src/main/local-pi-management/pi-management-diagnostics'

describe('Pi package diagnostics', () => {
  it('does not echo custom package-command credentials across IPC or into bootstrap records', () => {
    expect(safePiManagementMessage(
      '/usr/bin/env PRIVATE_REGISTRY_CREDENTIAL=fixture-secret npm install npm:fixture@1.0.0 failed with code 1',
      ['/usr/bin/env', 'PRIVATE_REGISTRY_CREDENTIAL=fixture-secret', 'npm'],
    )).toBe('env install npm:fixture@1.0.0 failed with code 1')
  })

  it('redacts common URL, authorization and registry token forms before truncation', () => {
    const sanitized = safePiManagementMessage('https://person:fixture-password@registry.example/path?_authToken=fixture-token&ok=1 authorization=fixture-auth password="fixture phrase" api_key=fixture-key')
    expect(sanitized).not.toContain('fixture-')
    expect(sanitized).not.toContain('fixture phrase')
    expect(sanitized).toContain('registry.example')
    expect(sanitized).toContain('ok=1')
    expect(safePiManagementMessage('x'.repeat(3_000))).toHaveLength(2_048)
  })

  it('redacts the credential after an authorization scheme, not just the scheme', () => {
    for (const input of [
      'Authorization: Bearer fixture-bearer-token',
      'authorization=Basic fixture-basic-value',
      '{"authorization":"Bearer fixture-json-token"}',
      'proxy-authorization: token fixture-proxy-token',
    ]) {
      const sanitized = safePiManagementMessage(input)
      expect(sanitized).not.toContain('fixture-')
      expect(sanitized).toContain('[redacted]')
    }
  })

  it('redacts npm config and environment credential forms', () => {
    const npmConfig = safePiManagementMessage('npm config set //registry.example/:_auth "fixture-npm-auth" failed')
    expect(npmConfig).not.toContain('fixture-npm-auth')
    expect(npmConfig).toContain('registry.example')
    expect(npmConfig).toContain('failed')
    const env = safePiManagementMessage('spawn failed: NPM_TOKEN=fixture-npm-token NODE_AUTH_TOKEN="fixture quoted" GITHUB_PAT=fixture-pat NODE_ENV=production')
    expect(env).not.toContain('fixture-')
    expect(env).not.toContain('fixture quoted')
    expect(env).toContain('NODE_ENV=production')
  })

  it('keeps ordinary diagnostic prose readable', () => {
    for (const input of [
      'The password is wrong for this registry.',
      'Resolved 3 tokens; authentication is not configured.',
      'npm ERR! code E404 Not Found - GET https://registry.npmjs.org/fixture',
    ]) expect(safePiManagementMessage(input)).toBe(input)
  })
})
