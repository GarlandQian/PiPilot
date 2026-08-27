import rawMaterialIconTheme from 'material-icon-theme/dist/material-icons.json?raw'

type IconAssociations = Record<string, string>

interface MaterialIconThemeVariant {
  fileExtensions?: IconAssociations
  fileNames?: IconAssociations
  folderNames?: IconAssociations
  folderNamesExpanded?: IconAssociations
}

interface MaterialIconTheme extends MaterialIconThemeVariant {
  iconDefinitions: Record<string, { iconPath: string }>
  light?: MaterialIconThemeVariant
  file: string
  folder: string
  folderExpanded: string
}

interface AssociationLookup {
  exact: IconAssociations
  folded: ReadonlyMap<string, string>
}

interface ThemeLookups {
  fileExtensions: AssociationLookup
  fileNames: AssociationLookup
  folderNames: AssociationLookup
  folderNamesExpanded: AssociationLookup
}

export interface MaterialFileIconRequest {
  name: string
  path: string
  type: 'file' | 'dir'
  open?: boolean
}

export interface MaterialFileIconNames {
  dark: string
  light: string
}

const materialIconTheme = JSON.parse(rawMaterialIconTheme) as MaterialIconTheme

function mergeAssociations(
  base: IconAssociations | undefined,
  override: IconAssociations | undefined,
) {
  return { ...base, ...override }
}

function createLookup(associations: IconAssociations | undefined): AssociationLookup {
  const exact = associations ?? {}
  const folded = new Map<string, string>()
  for (const [key, value] of Object.entries(exact)) {
    const normalizedKey = key.toLocaleLowerCase('en-US')
    if (!folded.has(normalizedKey)) folded.set(normalizedKey, value)
  }
  return { exact, folded }
}

function createLookups(variant?: MaterialIconThemeVariant): ThemeLookups {
  return {
    fileExtensions: createLookup(variant?.fileExtensions),
    fileNames: createLookup(variant?.fileNames),
    folderNames: createLookup(variant?.folderNames),
    folderNamesExpanded: createLookup(variant?.folderNamesExpanded),
  }
}

const darkLookups = createLookups(materialIconTheme)
const lightLookups = createLookups({
  fileExtensions: mergeAssociations(
    materialIconTheme.fileExtensions,
    materialIconTheme.light?.fileExtensions,
  ),
  fileNames: mergeAssociations(
    materialIconTheme.fileNames,
    materialIconTheme.light?.fileNames,
  ),
  folderNames: mergeAssociations(
    materialIconTheme.folderNames,
    materialIconTheme.light?.folderNames,
  ),
  folderNamesExpanded: mergeAssociations(
    materialIconTheme.folderNamesExpanded,
    materialIconTheme.light?.folderNamesExpanded,
  ),
})

function lookup(associations: AssociationLookup, value: string) {
  return associations.exact[value]
    ?? associations.folded.get(value.toLocaleLowerCase('en-US'))
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function pathCandidates(name: string, path: string) {
  const normalizedPath = normalizePath(path)
  return normalizedPath && normalizedPath !== name
    ? [normalizedPath, name]
    : [name]
}

function extensionCandidates(name: string) {
  const candidates: string[] = []
  let dotIndex = name.indexOf('.')
  while (dotIndex >= 0 && dotIndex < name.length - 1) {
    candidates.push(name.slice(dotIndex + 1))
    dotIndex = name.indexOf('.', dotIndex + 1)
  }
  return candidates
}

function resolveFileIcon(
  name: string,
  path: string,
  lookups: ThemeLookups,
) {
  for (const candidate of pathCandidates(name, path)) {
    const icon = lookup(lookups.fileNames, candidate)
    if (icon) return icon
  }
  for (const extension of extensionCandidates(name)) {
    const icon = lookup(lookups.fileExtensions, extension)
    if (icon) return icon
  }
  return materialIconTheme.file
}

function resolveFolderIcon(
  name: string,
  path: string,
  open: boolean,
  lookups: ThemeLookups,
) {
  const associations = open ? lookups.folderNamesExpanded : lookups.folderNames
  for (const candidate of pathCandidates(name, path)) {
    const icon = lookup(associations, candidate)
    if (icon) return icon
  }
  return open ? materialIconTheme.folderExpanded : materialIconTheme.folder
}

function resolveForTheme(
  request: MaterialFileIconRequest,
  lookups: ThemeLookups,
) {
  return request.type === 'dir'
    ? resolveFolderIcon(request.name, request.path, request.open === true, lookups)
    : resolveFileIcon(request.name, request.path, lookups)
}

export function resolveMaterialFileIconNames(
  request: MaterialFileIconRequest,
): MaterialFileIconNames {
  return {
    dark: resolveForTheme(request, darkLookups),
    light: resolveForTheme(request, lightLookups),
  }
}

export function materialIconAssetName(iconName: string) {
  const iconPath = materialIconTheme.iconDefinitions[iconName]?.iconPath
  return iconPath?.match(/(?:^|\/)icons\/([^/]+\.svg)$/)?.[1]
}
