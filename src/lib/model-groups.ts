import type { LocalPiModel } from '@/shared/local-pi'

export interface ProviderModelGroup {
  provider: string
  models: LocalPiModel[]
}

/**
 * Group runtime models by provider for model pickers (status bar menu,
 * command palette). Providers and models sort alphabetically by display label.
 */
export function groupModelsByProvider(models: readonly LocalPiModel[]): ProviderModelGroup[] {
  const groups = new Map<string, LocalPiModel[]>()
  for (const model of models) {
    const group = groups.get(model.provider) ?? []
    group.push(model)
    groups.set(model.provider, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, entries]) => ({
      provider,
      models: [...entries].sort((left, right) =>
        (left.name || left.id).localeCompare(right.name || right.id)),
    }))
}
