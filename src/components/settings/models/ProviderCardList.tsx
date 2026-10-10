import type * as React from 'react'
import { TbAlertTriangle, TbCheck, TbCopy, TbDots, TbExternalLink, TbFlask, TbKeyOff, TbLoader2, TbSparkles, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import { localizedText, presetForProvider } from '@/shared/model-provider-presets'
import type { BuiltinProvider, ModelsConfigProvider } from '@/shared/models-config'
import type { TestState } from '../editor-page'
import { SettingsBadge, SettingsGroup, SettingsListRow, StatusText } from '../kit'
import { ProviderIcon } from './ProviderIcon'
import { builtinKeySource } from './BuiltinProviderEditor'

export type ProviderCardEntry =
  | { kind: 'custom'; id: string; provider: ModelsConfigProvider }
  | { kind: 'builtin'; id: string; provider: BuiltinProvider }

export interface ProviderCardActions {
  edit(entry: ProviderCardEntry): void
  test(entry: ProviderCardEntry): void
  duplicate(id: string): void
  fill(id: string): void
  remove(entry: ProviderCardEntry): void
}

function hostOf(url: string | undefined) {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The last test, or the state that matters most: no key, no models. */
export function TestStatus({ test }: { test?: TestState }) {
  const t = useT()
  if (!test) return null
  if (test.state === 'testing') return <StatusText icon={<TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}>{t('settings.models.testing')}</StatusText>
  if (test.state === 'success') return <StatusText tone="success" icon={<TbCheck className="size-3.5" aria-hidden />} title={test.preview}>{t('settings.models.list.testOk', { latency: test.latencyMs })}</StatusText>
  return <StatusText tone="danger" icon={<TbAlertTriangle className="size-3.5" aria-hidden />} title={test.message}>{t('settings.models.list.testFailed')}</StatusText>
}

/** Every provider in one list, like the accounts in System Settings. */
export function ProviderCardList({ entries, defaultProvider, builtinBaseUrls, tests, recent, disabled, actions, title, headerActions, empty }: {
  entries: readonly ProviderCardEntry[]
  defaultProvider?: string
  builtinBaseUrls: Readonly<Record<string, string | undefined>>
  tests: Readonly<Record<string, TestState>>
  /** Just saved: highlighted for a moment and scrolled into view. */
  recent: string | null
  disabled: boolean
  actions: ProviderCardActions
  title: string
  headerActions: React.ReactNode
  /** Shown as the only row while there is no provider. */
  empty?: React.ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  return <SettingsGroup title={title} actions={headerActions} boxRole={entries.length ? 'list' : undefined} data-models-provider-list={entries.length ? true : undefined}>
      {entries.length === 0 ? empty : null}
      {entries.map((entry) => {
        const match = presetForProvider({ id: entry.id, baseUrl: entry.provider.baseUrl, builtin: entry.kind === 'builtin' }, builtinBaseUrls)
        const name = entry.kind === 'custom' ? entry.provider.name || (match?.exact ? localizedText(match.preset.name, locale) : entry.id)
          : match ? localizedText(match.preset.name, locale) : entry.provider.name
        const version = match?.exact && match.preset.versions.length > 1 ? localizedText(match.version.label, locale) : null
        const models = entry.kind === 'custom' ? entry.provider.models : []
        const count = entry.kind === 'custom' ? models.length : entry.provider.modelCount
        const subtitle = [
          version,
          entry.kind === 'custom' ? hostOf(entry.provider.baseUrl) : t('settings.models.cards.builtin'),
          t('settings.models.providerModels', { count }),
        ].filter(Boolean).join(' · ')
        const holdsDefault = defaultProvider === entry.id
        const canTest = entry.kind === 'custom' ? models.length > 0 : entry.provider.configured
        const keyState = entry.kind === 'builtin' ? builtinKeySource(entry.provider, t) : null
        return <SettingsListRow key={`${entry.kind}:${entry.id}`} data-models-provider-card={entry.id} data-models-provider-kind={entry.kind}
          icon={<ProviderIcon icon={match?.preset.icon} name={name} size="row" />}
          title={name} subtitle={subtitle} recent={recent === entry.id} disabled={disabled}
          badges={holdsDefault ? <SettingsBadge tone="accent">{t('settings.models.cards.holdsDefault')}</SettingsBadge> : null}
          status={tests[entry.id] ? <TestStatus test={tests[entry.id]} />
            : entry.kind === 'custom' && models.length === 0 ? <StatusText tone="warning">{t('settings.models.cards.noModels')}</StatusText>
              : keyState ? <StatusText tone="success">{keyState}</StatusText> : null}
          onOpen={() => actions.edit(entry)} openLabel={t('settings.models.cards.edit', { name })}
          menu={<DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={disabled} aria-label={t('settings.models.providerActions', { name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canTest} onSelect={() => actions.test(entry)}><TbFlask aria-hidden />{t('settings.models.cards.testAction')}</DropdownMenuItem>
              {entry.kind === 'custom' ? <>
                <DropdownMenuItem onSelect={() => actions.duplicate(entry.id)}><TbCopy aria-hidden />{t('settings.models.duplicateProvider')}</DropdownMenuItem>
                <DropdownMenuItem disabled={models.length === 0} onSelect={() => actions.fill(entry.id)}><TbSparkles aria-hidden />{t('settings.models.backfill.open')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(entry)}><TbTrash aria-hidden />{t('settings.models.deleteProvider')}</DropdownMenuItem>
              </> : <>
                {match?.preset.website ? <DropdownMenuItem onSelect={() => window.open(match.preset.website, '_blank', 'noopener')}><TbExternalLink aria-hidden />{t('settings.models.cards.website')}</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={entry.provider.source !== 'stored'} onSelect={() => actions.remove(entry)}><TbKeyOff aria-hidden />{t('settings.models.builtin.removeKey')}</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>} />
      })}
  </SettingsGroup>
}
