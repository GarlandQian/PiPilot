interface CatalogSearchProject {
  projectId: string
  available: boolean
  catalogStatus?: string
}

/** Searching expands discovery without overwriting saved expansion choices. */
export function sessionCatalogLoadTargets(
  projects: readonly CatalogSearchProject[],
  expanded: ReadonlyMap<string, boolean>,
  searching: boolean,
): string[] {
  return projects.filter((project) => project.available &&
    !project.catalogStatus && (searching || expanded.get(project.projectId) === true))
    .map((project) => project.projectId)
}
