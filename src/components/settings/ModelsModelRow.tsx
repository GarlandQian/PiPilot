import { TbCheck, TbDots, TbEdit, TbFlask, TbLoader2, TbStar, TbStarFilled, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import type { ModelsConfigModel } from '@/shared/models-config'
import { modelSelectionKey, type ModelsManager } from './useModelsManager'
import { currentModelTest } from './models-test-state'

export function ModelsModelRow({ model, providerId, manager, numberFormat }: {
  model: ModelsConfigModel
  providerId: string
  manager: ModelsManager
  numberFormat: Intl.NumberFormat
}) {
  const t = useT()
  const key = modelSelectionKey(providerId, model.id)
  const test = currentModelTest(manager.modelTests, key, manager.revision)
  const isDefault = manager.isDefault(providerId, model.id)
  const disabled = !manager.snapshot || !manager.parsed.valid || manager.loading || manager.saving
  const saved = manager.snapshot?.providers.some((provider) =>
    provider.id === providerId && provider.models.some((candidate) => candidate.id === model.id))
  return <article className="min-w-0 border-t border-border/70 py-4 first:border-t-0" data-model-id={model.id}>
    <div className="flex min-w-0 items-start gap-3">
      <Checkbox className="mt-1" checked={manager.selectedCustomModels.has(key)} disabled={disabled}
        aria-label={t('settings.models.selectModel', { name: model.name || model.id })}
        onCheckedChange={(checked) => manager.toggleCustomModel(providerId, model.id, checked === true)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="break-words text-app font-medium text-foreground">{model.name || model.id}</h4>
          {isDefault ? <span className="inline-flex items-center gap-1 text-micro text-sage"><TbCheck aria-hidden />{t('settings.models.defaultBadge')}</span> : null}
        </div>
        {model.name && model.name !== model.id ? <p className="mt-0.5 break-all font-mono text-micro text-muted-foreground">{model.id}</p> : null}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-micro text-muted-foreground">
          {model.reasoning ? <span>{t('settings.models.form.reasoning')}</span> : null}
          {model.input?.includes('image') ? <span>{t('settings.models.workspace.vision')}</span> : null}
          {model.contextWindow !== undefined ? <span>{t('settings.models.workspace.context', { count: numberFormat.format(model.contextWindow) })}</span> : null}
          {model.maxTokens !== undefined ? <span>{t('settings.models.workspace.output', { count: numberFormat.format(model.maxTokens) })}</span> : null}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex"><Button variant="ghost" size="icon-sm"
          disabled={disabled || manager.defaultBusy !== null || !saved}
          aria-label={`${t('settings.models.setDefault')} ${model.name || model.id}`}
          onClick={() => void manager.setDefault(providerId, model.id)}>
          {manager.defaultBusy === key ? <TbLoader2 className="animate-spin" aria-hidden />
            : isDefault ? <TbStarFilled className="text-sage" aria-hidden /> : <TbStar aria-hidden />}
        </Button></span></TooltipTrigger>
        <TooltipContent>{t(saved ? 'settings.models.setDefault' : 'settings.models.workspace.saveBeforeDefault')}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={disabled}
          aria-label={t('settings.models.modelActions', { name: model.name || model.id })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => manager.setModelDialog({ providerId, mode: 'edit', model })}><TbEdit aria-hidden />{t('settings.models.editModel')}</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => manager.setRemoveModel({ providerId, modelId: model.id })}><TbTrash aria-hidden />{t('settings.models.deleteModel')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="mt-2 flex flex-wrap items-start gap-2 pl-7">
      <Button variant="ghost" size="xs" disabled={!manager.available || disabled || test?.state === 'testing'}
        onClick={() => void manager.testModel(providerId, model.id)}>
        {test?.state === 'testing' ? <TbLoader2 className="animate-spin" aria-hidden /> : <TbFlask aria-hidden />}
        {t(test?.state === 'testing' ? 'settings.models.testing' : 'settings.models.testModel')}
      </Button>
      {test?.state === 'success' ? <div className="min-w-0 flex-1 pt-1 text-caption" role="status">
        <p className="text-success">{t('settings.models.testSuccess', { latency: test.latencyMs })}</p>
        <div className="mt-1 text-muted-foreground [&_.md-body]:text-caption"><MarkdownContent markdown={test.responsePreview || t('settings.models.testNoPreview')} /></div>
      </div> : test?.state === 'error' ? <div className="min-w-0 flex-1 pt-1 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive" role="alert">
        <MarkdownContent markdown={test.message} />
      </div> : null}
    </div>
  </article>
}
