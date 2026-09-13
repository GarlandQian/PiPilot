import { describe, expect, it } from 'vitest'
import { filterIntegrationPackages, filterIntegrationResources } from '../../src/components/settings/integrations/catalog-model'
import type { PiPackageSummary, PiResourceSummary } from '../../src/shared/pi-integrations'

const packages: PiPackageSummary[] = [
  { id: 'alpha', displayName: 'Project Helpers', source: 'npm:helpers', sourceType: 'npm', scope: 'project', installedVersion: '2.1.0', installedPath: '/fixture/helpers', pinned: false, filtered: false, updateAvailable: true, resourceCounts: { extension: 1, skill: 1, prompt: 0, theme: 0 }, compatibility: 'generic-rpc' },
  { id: 'beta', displayName: 'Global Theme', source: '/fixture/themes', sourceType: 'local', scope: 'global', pinned: false, filtered: false, updateAvailable: false, resourceCounts: { extension: 0, skill: 0, prompt: 0, theme: 1 }, compatibility: 'pi-tui-only' },
]
const resources: PiResourceSummary[] = [
  { id: 'skill', packageId: 'alpha', kind: 'skill', label: 'Review', path: '/fixture/skills/review/SKILL.md', source: 'npm:helpers', scope: 'project', effectiveState: 'enabled', invocation: '/skill:review', description: 'Inspect changes carefully', compatibility: 'generic-rpc' },
  { id: 'extension', packageId: 'alpha', kind: 'extension', label: 'Audit', path: '/fixture/audit.ts', source: 'npm:helpers', scope: 'project', effectiveState: 'disabled', compatibility: 'generic-rpc' },
  { id: 'theme', packageId: 'beta', kind: 'theme', label: 'Graphite', path: '/fixture/themes/graphite.json', source: '/fixture/themes', scope: 'global', effectiveState: 'inherited', compatibility: 'pi-tui-only' },
  { id: 'local-skill', kind: 'skill', label: 'Review', path: '/fixture/local/SKILL.md', source: 'local', scope: 'project', effectiveState: 'enabled', compatibility: 'not-observed' },
]

describe('integration catalog filtering', () => {
  it.each([' HELPERS ', '/fixture/helpers', '2.1.0'])('finds packages by current metadata: %s', (query) => {
    expect(filterIntegrationPackages(packages, query).map((pkg) => pkg.id)).toEqual(['alpha'])
  })

  it('combines package search and update filters without changing the source catalog', () => {
    expect(filterIntegrationPackages(packages, '', true)).toEqual([packages[0]])
    expect(filterIntegrationPackages(packages, 'Theme', true)).toEqual([])
    expect(filterIntegrationPackages(packages, '')).toEqual(packages)
    expect(packages[1]?.scope).toBe('global')
  })

  it.each([' REVIEW ', 'SKILL.md', '/skill:review', 'changes carefully'])('finds resource content and invocation: %s', (query) => {
    expect(filterIntegrationResources(resources, { query, kind: 'all', packageId: 'alpha' }).map((resource) => resource.id)).toEqual(['skill'])
  })

  it('scopes package links and resource kinds together', () => {
    expect(filterIntegrationResources(resources, { query: '', kind: 'all', packageId: 'alpha' }).map((resource) => resource.id)).toEqual(['skill', 'extension'])
    expect(filterIntegrationResources(resources, { query: '', kind: 'skill', packageId: 'alpha' }).map((resource) => resource.id)).toEqual(['skill'])
    expect(filterIntegrationResources(resources, { query: '', kind: 'skill' }).map((resource) => resource.id)).toEqual(['skill', 'local-skill'])
    expect(filterIntegrationResources(resources, { query: '', kind: 'all', packageId: 'deleted-package' })).toEqual([])
  })

  it('keeps actual inherited and disabled resource states', () => {
    expect(filterIntegrationResources(resources, { query: 'audit', kind: 'all' })[0]?.effectiveState).toBe('disabled')
    expect(filterIntegrationResources(resources, { query: 'graphite', kind: 'all' })[0]?.effectiveState).toBe('inherited')
  })
})
