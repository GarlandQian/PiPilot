import * as React from 'react'
import { TbFile, TbFolder, TbLoader2, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT, type MessageKey } from '@/i18n'
import { WorkspaceFileViewer } from './WorkspaceFileViewer'
import type { InspectorResourcesController, InspectorResourcesSnapshot } from './inspector-resources'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'
import { WorkspacePathContextMenu } from './WorkspacePathContextMenu'

const TREE_TAB = '.'

export function InspectorFileTabs({ controller, snapshot, errorMessageKey, children, onAddToComposer }: {
  controller: InspectorResourcesController
  snapshot: InspectorResourcesSnapshot
  errorMessageKey: (code: string) => MessageKey
  children: React.ReactNode
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
}) {
  const t = useT()
  const tabButtons = React.useRef(new Map<string, HTMLButtonElement>())
  const restoreFocus = React.useRef(false)
  const strip = React.useRef<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => {
    const button = tabButtons.current.get(snapshot.activePath ?? TREE_TAB)
    const viewport = strip.current
    if (!button || !viewport) return
    if (restoreFocus.current) {
      button.focus({ preventScroll: true })
      restoreFocus.current = false
    }
    const left = button.offsetLeft
    const right = left + button.offsetWidth
    if (left < viewport.scrollLeft) viewport.scrollLeft = left
    else if (right > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = right - viewport.clientWidth
  }, [snapshot.activePath, snapshot.files.length])
  const closeFile = (path: string) => {
    restoreFocus.current = true
    controller.close(path)
  }
  const backToTree = () => {
    restoreFocus.current = true
    controller.showTree()
  }
  const rememberTab = (path: string, button: HTMLButtonElement | null) => {
    if (button) tabButtons.current.set(path, button)
    else tabButtons.current.delete(path)
  }
  return (
    <Tabs value={snapshot.activePath ?? TREE_TAB} onValueChange={(value) => {
      if (value === TREE_TAB) controller.showTree()
      else controller.open(value)
    }} className="flex h-full min-h-0 min-w-0 flex-col gap-0">
      <div ref={strip} className="scroll-slim relative shrink-0 overflow-x-auto border-b border-border">
        <TabsList aria-label={t('inspector.openFiles')} variant="line" className="h-9 w-max min-w-full justify-start gap-0 p-0">
          <TabsTrigger ref={(button) => rememberTab(TREE_TAB, button)} value={TREE_TAB} className="h-9 flex-none rounded-none px-2 text-caption after:hidden" aria-label={t('inspector.files.workspaceTree')}>
            <TbFolder className="size-3.5" aria-hidden />
            {snapshot.files.length === 0 ? t('inspector.files.workspaceTree') : null}
          </TabsTrigger>
          {snapshot.files.map((file) => <div key={file.path} className="flex h-9 shrink-0 items-center border-r border-border/60 data-[active=true]:bg-background" data-active={snapshot.activePath === file.path}>
            <WorkspacePathContextMenu entry={{ name: file.path.split('/').pop() ?? file.path, path: file.path, type: 'file' }} onAddToComposer={onAddToComposer}>
            <TabsTrigger
              ref={(button) => rememberTab(file.path, button)}
              value={file.path}
              title={file.path}
              aria-label={file.path}
              onKeyDown={(event) => {
                if (event.key !== 'Delete') return
                event.preventDefault()
                closeFile(file.path)
              }}
              className="h-9 max-w-40 flex-none gap-1.5 rounded-none border-0 px-2 text-caption after:hidden data-[state=active]:bg-transparent"
            >
              {file.phase === 'loading' ? <TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : <TbFile className="size-3" aria-hidden />}
              <span className="truncate">{file.path.split('/').pop()}</span>
            </TabsTrigger>
            </WorkspacePathContextMenu>
            <Button variant="ghost" size="icon-xs" className="mr-1 size-5" aria-label={t('inspector.closeFile', { path: file.path })} onClick={() => closeFile(file.path)}><TbX className="size-3" aria-hidden /></Button>
          </div>)}
        </TabsList>
      </div>
      {snapshot.atCapacity ? <p role="status" className="shrink-0 border-b border-border px-3 py-2 text-caption text-muted-foreground">{t('inspector.preview.limit')}</p> : null}
      <TabsContent value={TREE_TAB} forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden" aria-label={t('inspector.files.workspaceTree')}>
        {children}
      </TabsContent>
      {snapshot.files.map((file) => <TabsContent key={file.path} value={file.path} forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
        <WorkspaceFileViewer
          path={file.path}
          preview={file.preview}
          loading={file.phase === 'loading' && !file.preview}
          refreshing={file.phase === 'loading' && Boolean(file.preview)}
          errorMessage={file.errorCode ? t(errorMessageKey(file.errorCode)) : undefined}
          onBack={backToTree}
          onClose={() => closeFile(file.path)}
          onRetry={() => controller.open(file.path, true)}
          onRefresh={() => controller.open(file.path, true)}
        />
      </TabsContent>)}
    </Tabs>
  )
}
