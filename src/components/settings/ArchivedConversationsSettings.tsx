import * as React from 'react'
import { TbLoader2, TbRefresh, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ConversationList, type ConversationListActions, type SidebarConversationItem } from '@/components/layout/SessionList'
import { sidebarConversationTitle } from '@/components/layout/session-navigation'
import { useT } from '@/i18n'
import { loadOfficialSessionCatalog } from '@/renderer/adapters/workspace-adapter'
import { deleteArchivedSessions, type ArchivedDeletionFailure } from '@/renderer/delete-archived-sessions'
import { removeTaskOrganization, type NavigationPreferences } from '@/renderer/navigation-preferences'
import { useWorkspaceStore } from '@/store/workspace'
import { SettingsGroup, SettingsPage } from './kit'

export function ArchivedConversationsSettings({ items, actions, activeSessionId, now, loading, unresolvedCount, preferences, onPreferencesChange, onRefresh }: {
  items: readonly SidebarConversationItem[]
  actions: ConversationListActions
  activeSessionId: string
  now: number
  loading: boolean
  unresolvedCount: number
  preferences: NavigationPreferences
  onPreferencesChange(preferences: NavigationPreferences): void
  onRefresh(): void
}) {
  const t = useT()
  const workspace = useWorkspaceStore()
  const [confirmedTargets, setConfirmedTargets] = React.useState<readonly SidebarConversationItem[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const busyRef = React.useRef(false)
  const [failures, setFailures] = React.useState<readonly ArchivedDeletionFailure[]>([])
  const preferencesRef = React.useRef(preferences)
  preferencesRef.current = preferences
  const openingArchivedConversation = items.some((item) => item.loading)
  const removeAll = async () => {
    if (!confirmedTargets || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFailures([])
    const errors = await deleteArchivedSessions(confirmedTargets.map((item) => item.summary), {
      preferences: () => preferencesRef.current,
      list: async (scope) => {
        if (!window.pipilot) throw new Error(t('workbenchReview.sessions.unavailable'))
        return loadOfficialSessionCatalog(window.pipilot.sessionCatalog, scope, true)
      },
      delete: (summary) => workspace.deleteSession(summary.scope, summary.selectionToken),
      deleted: (summary) => {
        const next = removeTaskOrganization(preferencesRef.current, summary)
        preferencesRef.current = next
        onPreferencesChange(next)
      },
    })
    setFailures(errors)
    setConfirmedTargets(null)
    busyRef.current = false
    setBusy(false)
  }
  return <SettingsPage data-archive-settings aria-busy={busy || loading || undefined}>
    <p className="text-caption text-muted-foreground">{t('settings.archived.description')}</p>
    <SettingsGroup title={t('settings.archived.count', { count: items.length })} actions={<>
      <Button variant="ghost" size="icon-xs" disabled={busy || loading} aria-label={t('common.refresh')} onClick={onRefresh}><TbRefresh aria-hidden /></Button>
      <Button variant="outline" size="sm" disabled={busy || loading || openingArchivedConversation || items.length === 0} onClick={() => { setFailures([]); setConfirmedTargets([...items]) }}>
        <TbTrash aria-hidden />{t('settings.archived.deleteAll')}
      </Button>
    </>}>
      {loading ? <p role="status" className="flex items-center gap-2 px-3 py-4 text-caption text-muted-foreground"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('sidebar.project.loading')}</p> : null}
      <div className="px-1 py-2">
        <ConversationList {...actions} items={busy ? items.map((item) => ({ ...item, disabled: true })) : items}
          activeSessionId={activeSessionId} now={now} variant="archived"
          emptyLabel={loading ? undefined : t('nav.redesign.archiveEmpty')} />
      </div>
    </SettingsGroup>
    {unresolvedCount > 0 ? <p role="status" className="text-caption text-muted-foreground">{t('settings.archived.unavailable', { count: unresolvedCount })}</p> : null}
    {failures.length ? <div role="alert" className="space-y-1 text-caption text-destructive">
      <p>{t('settings.archived.failed')}</p>
      <ul className="list-disc space-y-1 pl-5">
        {failures.map((failure, index) => <li key={index} className="break-words">
          {sidebarConversationTitle(failure.summary, t('sidebar.session.untitled'))}: {failure.message || t(`settings.archived.failure.${failure.reason}`)}
        </li>)}
      </ul>
    </div> : null}
    <AlertDialog open={confirmedTargets !== null} onOpenChange={(open) => { if (!open && !busyRef.current) setConfirmedTargets(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.archived.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.archived.deleteDescription', { count: confirmedTargets?.length ?? 0 })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void removeAll()}>
            {busy ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbTrash aria-hidden />}
            {t(busy ? 'settings.archived.deleting' : 'settings.archived.deleteAll')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
