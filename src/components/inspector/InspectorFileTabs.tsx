import type * as React from 'react'
import { useT, type MessageKey } from '@/i18n'
import { WorkspaceFileViewer } from './WorkspaceFileViewer'
import type { InspectorResourcesController, InspectorResourcesSnapshot } from './inspector-resources'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'

/** One resource header owns navigation; cached readers stay mounted underneath. */
export function InspectorFileTabs({ controller, snapshot, errorMessageKey, children, onAddToComposer, onShowChanges, workspaceName }: {
  controller: InspectorResourcesController
  snapshot: InspectorResourcesSnapshot
  errorMessageKey: (code: string) => MessageKey
  children: React.ReactNode
  onAddToComposer?: (entry: WorkspacePathSearchEntry) => void
  onShowChanges?: (path: string) => void
  workspaceName?: string
}) {
  const t = useT()
  const navigation = (path: string | null) => <select
    aria-label={t('inspector.openFiles')}
    value={path ?? '.'}
    onChange={(event) => event.target.value === '.' ? controller.showTree() : controller.open(event.target.value)}
    className="h-7 w-full min-w-0 cursor-pointer rounded bg-transparent pr-1 font-mono text-caption text-foreground outline-none focus-visible:focus-ring"
  >
    <option value=".">{t('inspector.files.workspaceTree')}</option>
    {snapshot.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
  </select>
  return <div className="flex h-full min-h-0 min-w-0 flex-col">
    {snapshot.atCapacity ? <p role="status" className="shrink-0 border-b border-border px-3 py-2 text-caption text-muted-foreground">{t('inspector.preview.limit')}</p> : null}
    <section hidden={snapshot.activePath !== null} className="flex min-h-0 flex-1 flex-col" aria-label={t('inspector.files.workspaceTree')}>
      {snapshot.files.length > 0 ? <div className="shrink-0 border-b border-border px-2">{navigation(null)}</div> : null}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
    {snapshot.files.map((file) => <section key={file.path} hidden={snapshot.activePath !== file.path} className="min-h-0 flex-1" aria-label={file.path}>
      <WorkspaceFileViewer
        path={file.path}
        workspaceName={workspaceName}
        fileNavigation={navigation(file.path)}
        preview={file.preview}
        loading={file.phase === 'loading' && !file.preview}
        refreshing={file.phase === 'loading' && Boolean(file.preview)}
        errorMessage={file.errorCode ? t(errorMessageKey(file.errorCode)) : undefined}
        onBack={() => controller.showTree()}
        onClose={() => controller.close(file.path)}
        onRetry={() => controller.open(file.path, true)}
        onRefresh={() => controller.open(file.path, true)}
        onShowChanges={onShowChanges ? () => onShowChanges(file.path) : undefined}
        onAddToComposer={onAddToComposer ? () => onAddToComposer({ path: file.path, name: file.path.split('/').pop() ?? file.path, type: 'file' }) : undefined}
      />
    </section>)}
  </div>
}
