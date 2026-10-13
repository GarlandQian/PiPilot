import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { persistPiRetrySettings } from '../../src/main/local-pi-management/pi-retry-settings'

describe('global Pi retry settings persistence', () => {
  it('writes count and enabled together while preserving unrelated fields and project overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-retry-settings-'))
    try {
      const agentDir = join(root, 'agent')
      const cwd = join(root, 'project')
      await Promise.all([mkdir(agentDir), mkdir(join(cwd, '.pi'), { recursive: true })])
      await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ theme: 'dark', retry: { baseDelayMs: 500, provider: { maxRetries: 2 } } }))
      await writeFile(join(cwd, '.pi', 'settings.json'), JSON.stringify({ retry: { enabled: true, maxRetries: 7 } }))
      await persistPiRetrySettings(cwd, agentDir, { enabled: false, maxRetries: 5 })
      expect(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))).toEqual({
        theme: 'dark', retry: { enabled: false, maxRetries: 5, baseDelayMs: 500, provider: { maxRetries: 2 } },
      })
      expect(SettingsManager.create(cwd, agentDir, { projectTrusted: true }).getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 7, baseDelayMs: 500 })
      await persistPiRetrySettings(cwd, agentDir, { enabled: true })
      expect(SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 5 })
      await persistPiRetrySettings(cwd, agentDir, { enabled: true, maxRetries: 0 })
      expect(SettingsManager.create(cwd, agentDir, { projectTrusted: false }).getRetrySettings().maxRetries).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('keeps default 3 and refuses to overwrite malformed settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-retry-default-'))
    try {
      const settingsPath = join(root, 'settings.json')
      await persistPiRetrySettings(root, root, { enabled: true })
      expect(SettingsManager.create(root, root).getRetrySettings().maxRetries).toBe(3)
      for (const invalid of ['not json', '[]', '{"retry":[]}']) {
        await writeFile(settingsPath, invalid)
        await expect(persistPiRetrySettings(root, root, { enabled: true, maxRetries: 3 })).rejects.toThrow()
        expect(await readFile(settingsPath, 'utf8')).toBe(invalid)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
