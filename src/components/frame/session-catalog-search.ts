interface CatalogSearchProject {
  projectId: string
  available: boolean
  catalogStatus?: string
}

/** The provider's startup loading placeholder may outlive a restored project selection. */
export function projectlessCatalogNeedsDiscovery(
  mode: string,
  activeScopeKind: 'project' | 'projectless',
  catalogStatus?: string,
): boolean {
  return mode === 'electron' && (catalogStatus === undefined ||
    (catalogStatus === 'loading' && activeScopeKind === 'project'))
}

/** Searching expands discovery without overwriting saved expansion choices. */
export function sessionCatalogLoadTargets(
  projects: readonly CatalogSearchProject[],
  expanded: ReadonlyMap<string, boolean>,
  searching: boolean,
  activeProjectIds: ReadonlySet<string> = new Set(),
): string[] {
  return projects.filter((project) => project.available &&
    !project.catalogStatus && (searching || expanded.get(project.projectId) === true || activeProjectIds.has(project.projectId)))
    .map((project) => project.projectId)
}
