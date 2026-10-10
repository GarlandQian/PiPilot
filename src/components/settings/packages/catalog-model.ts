import type { PiPackageSummary, PiResourceKind, PiResourceSummary } from '@/shared/pi-integrations'

export function filterIntegrationPackages(packages: readonly PiPackageSummary[], query: string, updatesOnly = false) {
  const needle = query.trim().toLocaleLowerCase()
  return packages.filter((pkg) => (!updatesOnly || pkg.updateAvailable) && (!needle || [
    pkg.displayName,
    pkg.source,
    pkg.installedPath,
    pkg.installedVersion,
  ].some((value) => value?.toLocaleLowerCase().includes(needle))))
}

export interface IntegrationResourceFilter {
  query: string
  kind: 'all' | PiResourceKind
  packageId?: string
}

export function filterIntegrationResources(resources: readonly PiResourceSummary[], filter: IntegrationResourceFilter) {
  const needle = filter.query.trim().toLocaleLowerCase()
  return resources.filter((resource) =>
    (filter.kind === 'all' || resource.kind === filter.kind) &&
    (!filter.packageId || resource.packageId === filter.packageId) &&
    (!needle || [resource.label, resource.source, resource.path, resource.invocation, resource.description]
      .some((value) => value?.toLocaleLowerCase().includes(needle))))
}
