import type { ModelsConfigModel, ModelsConfigProvider } from '@/shared/models-config'

export interface ModelProviderSearchResult {
  provider: ModelsConfigProvider
  models: readonly ModelsConfigModel[]
}

/** Search only public identity fields; credentials and raw definitions stay outside the index. */
export function searchModelProviders(
  providers: readonly ModelsConfigProvider[],
  query: string,
): readonly ModelProviderSearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return providers.flatMap((provider) => {
    const identity = [provider.id, provider.name, provider.api, provider.baseUrl].filter(Boolean).join(' ').toLowerCase()
    const providerMatches = terms.every((term) => identity.includes(term))
    const models = providerMatches ? provider.models : provider.models.filter((model) =>
      terms.every((term) => `${identity} ${model.id} ${model.name ?? ''}`.toLowerCase().includes(term)))
    return providerMatches || models.length > 0 ? [{ provider, models }] : []
  })
}
