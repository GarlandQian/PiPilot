import type { Plugin } from 'vite'

export interface PackageNotice { name: string; version: string; license: string; url: string; text: string }
export function packageRootOf(file: string): string | undefined
export function describePackage(root: string): PackageNotice
export function runtimeDependencyRoots(projectRoot: string, excluded?: readonly string[]): Set<string>
export function buildNotices(packages: readonly PackageNotice[], extra?: readonly PackageNotice[]): {
  packages: Array<Omit<PackageNotice, 'text'> & { textId?: string }>
  texts: Record<string, string>
}
export function thirdPartyNotices(options: {
  projectRoot: string
  write?: boolean
  outFile?: string
  excluded?: readonly string[]
  extra?: readonly PackageNotice[]
}): Plugin
