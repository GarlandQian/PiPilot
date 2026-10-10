import type { MessageKey } from '@/i18n'
import type { ModelCatalogDetails } from '@/shared/model-catalog'

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

/** "models.dev", or Pi's catalog in the reader's language. */
export function catalogName(t: Translate, details: ModelCatalogDetails | null | undefined) {
  return details?.source?.catalog === 'pi' ? t('settings.models.fill.piCatalog') : 'models.dev'
}

/** The catalogs a set of fills came from, named once each. */
export function catalogNames(t: Translate, all: readonly (ModelCatalogDetails | null | undefined)[]) {
  return [...new Set(all.filter(Boolean).map((details) => catalogName(t, details)))].join(' · ') || 'models.dev'
}

/** "Filled in from models.dev (DeepSeek’s own entry) · the price is DeepSeek’s list price". */
export function fillSourceText(t: Translate, details: ModelCatalogDetails, priceSet: boolean) {
  const source = details.source
  const basis = !source || source.basis === 'consensus' || !source.name
    ? t('settings.models.fill.basis.consensus')
    : t(source.basis === 'provider' ? 'settings.models.fill.basis.provider' : 'settings.models.fill.basis.maker', { name: source.name })
  const parts = [t('settings.models.fill.from', { catalog: catalogName(t, details), basis })]
  if (details.price?.by === 'maker') parts.push(details.price.name
    ? t('settings.models.fill.referencePrice', { name: details.price.name })
    : t('settings.models.fill.referencePriceGeneric'))
  else if (!details.cost && !priceSet) parts.push(t('settings.models.fill.noPrice'))
  return parts.join(' · ')
}

/** The note under a price that is still the maker's list price. */
export function referencePriceText(t: Translate, details: ModelCatalogDetails) {
  return details.price?.name ? t('settings.models.editor.referencePrice', { name: details.price.name }) : t('settings.models.editor.referencePriceGeneric')
}
