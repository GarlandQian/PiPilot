import * as React from 'react'
import { TbAlertTriangle, TbLoader2, TbRefresh, TbSearch } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { ModelsRemoteListResult } from '@/shared/models-config'

type RemoteModel = ModelsRemoteListResult['models'][number]

/** The endpoint's own model list: pick several at once. */
export function RemoteModelsDialog({ open, onOpenChange, load, existingIds, onAdd }: {
  open: boolean
  onOpenChange(open: boolean): void
  load(): Promise<ModelsRemoteListResult>
  existingIds: readonly string[]
  onAdd(models: RemoteModel[]): void
}) {
  const t = useT()
  const [state, setState] = React.useState<{ phase: 'loading' } | { phase: 'ready'; models: RemoteModel[] } | { phase: 'error'; message: string }>({ phase: 'loading' })
  const [query, setQuery] = React.useState('')
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(() => new Set())
  const request = React.useRef(0)
  const loadRef = React.useRef(load)
  loadRef.current = load
  const existing = React.useMemo(() => new Set(existingIds), [existingIds])

  const fetchList = React.useCallback(async () => {
    const current = ++request.current
    setState({ phase: 'loading' })
    try {
      const result = await loadRef.current()
      if (current === request.current) setState({ phase: 'ready', models: result.models })
    } catch (error) {
      if (current === request.current) setState({ phase: 'error', message: error instanceof Error && error.message ? error.message : t('settings.models.editor.listFailed') })
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setChecked(new Set())
    void fetchList()
  }, [open, fetchList])

  const models = state.phase === 'ready' ? state.models : []
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  const visible = models.filter((model) => words.every((word) => `${model.id} ${model.name ?? ''}`.toLowerCase().includes(word)))
  const selectable = visible.filter((model) => !existing.has(model.id))
  const allChecked = selectable.length > 0 && selectable.every((model) => checked.has(model.id))
  const toggle = (id: string, on: boolean) => setChecked((current) => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[min(640px,calc(100vh-4rem))] flex-col sm:max-w-[560px]" data-models-remote-dialog>
      <DialogHeader>
        <DialogTitle>{t('settings.models.editor.fetchTitle')}</DialogTitle>
        <DialogDescription>{t('settings.models.editor.fetchDescription')}</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} autoFocus onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings.models.editor.searchModels')} aria-label={t('settings.models.editor.searchModels')} className="h-7 rounded-full bg-fill pl-7.5 shadow-none" />
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t('common.refresh')} disabled={state.phase === 'loading'} onClick={() => void fetchList()}>
          <TbRefresh className={state.phase === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
        </Button>
      </div>
      <div className="scroll-slim min-h-40 min-w-0 flex-1 overflow-y-auto rounded-lg bg-fill p-1">
        {state.phase === 'loading' ? <p className="flex items-center justify-center gap-2 py-12 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.models.editor.listing')}</p>
          : state.phase === 'error' ? <div className="space-y-2 px-3 py-8 text-center" role="alert">
            <p className="flex items-center justify-center gap-1.5 text-caption text-destructive"><TbAlertTriangle className="size-4" aria-hidden />{t('settings.models.editor.listFailed')}</p>
            <p className="break-words text-micro text-muted-foreground">{state.message}</p>
            <p className="text-micro text-muted-foreground">{t('settings.models.editor.listFailedHint')}</p>
          </div>
            : visible.length === 0 ? <p className="py-12 text-center text-caption text-muted-foreground">{t(models.length ? 'settings.models.workspace.noMatches' : 'settings.models.editor.listEmpty')}</p>
              : <>
                <label className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-micro text-muted-foreground">
                  <Checkbox checked={allChecked ? true : selectable.some((model) => checked.has(model.id)) ? 'indeterminate' : false} disabled={selectable.length === 0}
                    onCheckedChange={(on) => { for (const model of selectable) toggle(model.id, on === true) }} />
                  {t('settings.models.editor.selectAll', { count: selectable.length })}
                </label>
                {visible.map((model) => {
                  const added = existing.has(model.id)
                  return <label key={model.id} className="flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-fill-strong has-[:disabled]:opacity-60">
                    <Checkbox checked={added || checked.has(model.id)} disabled={added} onCheckedChange={(on) => toggle(model.id, on === true)} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-all font-mono text-caption">{model.id}</span>
                      {model.name && model.name !== model.id ? <span className="block truncate text-micro text-muted-foreground">{model.name}</span> : null}
                    </span>
                    {added ? <span className="shrink-0 text-micro text-muted-foreground">{t('settings.models.editor.alreadyAdded')}</span> : null}
                  </label>
                })}
              </>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button disabled={checked.size === 0} onClick={() => onAdd(models.filter((model) => checked.has(model.id)))}>
          {t('settings.models.editor.addSelected', { count: checked.size })}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
