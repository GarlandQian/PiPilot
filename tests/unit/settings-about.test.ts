import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ApplicationUpdateStoreValue } from '../../src/store/application-update'
import { AboutSettings } from '../../src/components/settings/AboutSettings'

const state = vi.hoisted(() => ({ value: null as ApplicationUpdateStoreValue | null }))
vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/store/application-update', () => ({ useApplicationUpdate: () => state.value }))

describe('About update feedback', () => {
  it('shows a retryable initial bridge error instead of leaving update status loading', () => {
    state.value = {
      mode: 'electron', snapshot: null, busy: false, errorMessage: 'Update service unavailable', dismissedVersion: null,
      check: vi.fn(), download: vi.fn(), install: vi.fn(), openRelease: vi.fn(), dismissNotice: vi.fn(),
    }
    const markup = renderToStaticMarkup(createElement(AboutSettings))
    expect(markup).toMatch(/role="alert"[^]*Update service unavailable/u)
    expect(markup).toContain('applicationUpdate.retry')
  })

  it('shows action errors even when the authoritative snapshot is not an error state', () => {
    state.value = {
      mode: 'electron', snapshot: { revision: 1, state: 'current', checkedAt: null, policy: { platform: 'macos', package: 'macos', capability: 'manual-release', currentVersion: '0.0.4', releaseUrl: 'https://github.com/GarlandQian/PiPilot/releases' } }, busy: false, errorMessage: 'Unable to open release page', dismissedVersion: null,
      check: vi.fn(), download: vi.fn(), install: vi.fn(), openRelease: vi.fn(), dismissNotice: vi.fn(),
    }
    const markup = renderToStaticMarkup(createElement(AboutSettings))
    expect(markup).toContain('Unable to open release page')
    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('truncate')
  })

  it('does not label a loaded idle update service as still loading', () => {
    state.value = {
      mode: 'electron', snapshot: { revision: 1, state: 'idle', checkedAt: null, policy: { platform: 'macos', package: 'macos', capability: 'manual-release', currentVersion: '0.0.4', releaseUrl: 'https://github.com/GarlandQian/PiPilot/releases' } }, busy: false, errorMessage: null, dismissedVersion: null,
      check: vi.fn(), download: vi.fn(), install: vi.fn(), openRelease: vi.fn(), dismissNotice: vi.fn(),
    }
    const markup = renderToStaticMarkup(createElement(AboutSettings))
    expect(markup).toContain('settings.redesign.updatesIdle')
    expect(markup).toContain('applicationUpdate.check')
    expect(markup).not.toContain('role="alert"')
  })
})
