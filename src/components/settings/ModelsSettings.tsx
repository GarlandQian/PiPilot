import * as React from 'react'
import { TbCode, TbLoader2, TbRefresh } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ModelsConfigSnapshot } from '@/shared/models-config'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import { useModelsConfigurationDocument } from '@/store/configuration-documents'
import { SettingSection } from './common'
import { ConfigApplyNotice } from './ConfigApplyNotice'
import { ConfigurationDocumentError, ConfigurationDocumentUnavailable, ConfigurationReloadConfirmation } from './ConfigurationDocumentFeedback'
import { formValueFromModel, formValueFromProvider } from './models-form-model'
import { ModelsModelFormDialog } from './ModelsModelFormDialog'
import { ModelsProviderFormDialog } from './ModelsProviderFormDialog'
import { ModelsProviderWorkspace } from './ModelsProviderWorkspace'
import { ModelsRuntimeSettings } from './ModelsRuntimeSettings'
import { useModelsManager } from './useModelsManager'

export function ModelsSettings({ operationOwnerKey, active = true }: { operationOwnerKey: string; active?: boolean }) {
  const [, retry] = React.useReducer((value: number) => value + 1, 0)
  const { document, available } = useModelsConfigurationDocument()
  return document ? <ModelsDocumentSettings document={document} operationOwnerKey={operationOwnerKey} active={active} />
    : <ConfigurationDocumentUnavailable capacity={available} retry={retry} />
}

function ModelsDocumentSettings({ document, operationOwnerKey, active }: {
  document: ConfigurationDocument<ModelsConfigSnapshot>
  operationOwnerKey: string
  active: boolean
}) {
  const t = useT()
  const diagnosticsId = React.useId()
  const manager = useModelsManager(document, active)
  const {
    snapshot, draftText, view, dirty, parsed, loading, saving, apply, reloadOpen, setReloadOpen,
    error, status, documentError, savedApply, setView, updateDraft, load, save,
    providerDialog, setProviderDialog, modelDialog, setModelDialog, removeProviderId,
    setRemoveProviderId, removeModel, setRemoveModel, submitProviderForm, submitModelForm,
    removeProvider, removeModelFromProvider,
  } = manager

  return <div className="min-w-0 space-y-7" data-models-settings>
    <ModelsRuntimeSettings snapshot={snapshot} operationOwnerKey={operationOwnerKey} />
    <SettingSection title={t('settings.models.customProviders')} desc={t('settings.models.workspace.description')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-1" role="group" aria-label={t('settings.models.mode.form')}>
          {(['form', 'json'] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={view === candidate}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-caption text-muted-foreground outline-none hover:bg-accent/35 focus-visible:focus-ring aria-pressed:bg-accent/60 aria-pressed:font-medium aria-pressed:text-foreground"
            onClick={() => setView(candidate)}>{candidate === 'json' ? <TbCode className="size-4" aria-hidden /> : null}{t(`settings.models.mode.${candidate}`)}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {snapshot ? <span className={cn('mr-1 text-micro', dirty ? 'text-warning' : 'text-muted-foreground')} role="status">{t(dirty ? 'settings.document.unsaved' : 'settings.models.workspace.saved')}</span> : null}
          <Button variant="ghost" size="icon-sm" disabled={!manager.available || loading || saving} aria-label={t('common.refresh')} onClick={() => void load(true)}><TbRefresh className={loading ? 'animate-spin' : ''} aria-hidden /></Button>
          <Button variant="outline" size="sm" disabled={!dirty || !parsed.valid || loading || saving} onClick={() => void save(false)}>{t('common.save')}</Button>
          <Button size="sm" disabled={!snapshot || apply.status?.state === 'superseded' || !parsed.valid || loading || saving} onClick={() => void save(true)}>
            {saving ? <TbLoader2 className="animate-spin" aria-hidden /> : null}{t(dirty ? 'settings.models.saveRestart' : 'settings.configApply.retry')}
          </Button>
        </div>
      </div>
      <ConfigApplyNotice status={apply.status} readFailed={apply.readFailed} />
      <ConfigurationDocumentError error={documentError} />
      {(error || status) ? <div role={error ? 'alert' : 'status'} className={cn('text-caption [&_.md-body]:text-caption', error ? 'text-destructive [&_.md-body]:text-destructive' : 'text-muted-foreground')}><MarkdownContent markdown={error ?? status ?? ''} /></div> : null}
      {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.models.loading')}</div>
        : view === 'form' && parsed.valid ? <ModelsProviderWorkspace manager={manager} />
          : view === 'json' ? <div className="min-w-0 space-y-3">
            <p className="break-all font-mono text-micro text-muted-foreground">{snapshot?.path || t('settings.models.noPath')}</p>
            <Textarea value={draftText} onChange={(event) => updateDraft(event.target.value)} disabled={saving} spellCheck={false}
              aria-invalid={!parsed.valid} aria-describedby={parsed.diagnostics.length ? diagnosticsId : undefined} aria-label={t('settings.models.mode.json')}
              className="scroll-slim min-h-[28rem] resize-y bg-muted/20 p-4 font-mono text-caption leading-relaxed" />
          </div> : <div className="py-8 text-caption text-muted-foreground"><p>{t('settings.models.workspace.fixJson')}</p><Button variant="outline" className="mt-3" onClick={() => setView('json')}>{t('settings.models.mode.json')}</Button></div>}
      {parsed.diagnostics.length > 0 ? <div id={diagnosticsId} className="space-y-1 border-l-2 border-destructive pl-3" role="alert">
        {parsed.diagnostics.slice(0, 5).map((diagnostic, index) => <p key={`${diagnostic.code}:${diagnostic.offset}:${index}`} className="text-caption text-destructive">{t('settings.models.diagnostics', { line: diagnostic.line, column: diagnostic.column, message: diagnostic.message })}</p>)}
      </div> : null}
      {!snapshot?.applyStatus && savedApply ? <p className="py-2 text-caption text-muted-foreground" role="status">{t(`settings.models.apply.${savedApply}`)}</p> : null}
      <ConfigurationReloadConfirmation open={reloadOpen} onOpenChange={setReloadOpen} onReload={() => { setReloadOpen(false); void load() }} />
    </SettingSection>
      <ModelsProviderFormDialog
        open={providerDialog !== null}
        onOpenChange={(open) => !open && setProviderDialog(null)}
        mode={providerDialog?.mode === 'edit' ? 'edit' : 'add'}
        initial={providerDialog?.mode === 'edit'
          ? formValueFromProvider(providerDialog.provider)
          : undefined}
        hasApiKey={providerDialog?.mode === 'edit' ? providerDialog.provider.hasApiKey : false}
        existingIds={parsed.providers.map((provider) => provider.id)}
        onSubmit={submitProviderForm}
      />

      {modelDialog && (
        <ModelsModelFormDialog
          open
          onOpenChange={(open) => !open && setModelDialog(null)}
          mode={modelDialog.mode}
          initial={modelDialog.mode === 'edit'
            ? formValueFromModel(modelDialog.model)
            : undefined}
          existingIds={
            parsed.providers
              .find((provider) => provider.id === modelDialog.providerId)
              ?.models.map((model) => model.id) ?? []
          }
          onSubmit={submitModelForm}
        />
      )}

      <AlertDialog
        open={removeProviderId !== null}
        onOpenChange={(open) => !open && setRemoveProviderId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.models.deleteProviderConfirm', { name: removeProviderId ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.models.deleteProviderConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removeProviderId) removeProvider(removeProviderId)
                setRemoveProviderId(null)
              }}
            >
              {t('settings.models.deleteProvider')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeModel !== null}
        onOpenChange={(open) => !open && setRemoveModel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.models.deleteModelConfirm', {
                provider: removeModel?.providerId ?? '',
                name: removeModel?.modelId ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.models.deleteModelConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removeModel) removeModelFromProvider(removeModel.providerId, removeModel.modelId)
                setRemoveModel(null)
              }}
            >
              {t('settings.models.deleteModel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

  </div>
}
