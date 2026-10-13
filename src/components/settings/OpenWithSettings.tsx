import * as React from 'react'
import { TbCheck, TbDots, TbPencil, TbPlus, TbRefresh, TbTrash } from 'react-icons/tb'
import { OpenTargetIcon, useOpenTargetName, useTerminalAppName } from '@/components/inspector/OpenInEditorButton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/i18n'
import { isMacPlatform } from '@/lib/keyboard-shortcuts'
import { isAvailable, useOpenTargets, type OpenTarget } from '@/renderer/open-targets'
import { matchesAppId } from '@/shared/app-identity'
import { terminalCustomExternalAppSchema, type TerminalCustomExternalApp } from '@/shared/terminal-profiles'
import { useSettings, useSettingsSaveStatus, useUpdateSettings } from '@/store/settings'
import { FormActions, SettingsBadge, SettingsField, SettingsGroup, SettingsListRow, SettingsRow, SettingsSheet, StatusText } from './kit'
import { UnavailableDefaultRow } from './TerminalProfilesSettings'

const AUTOMATIC = '__automatic__'

interface Draft { id: string; name: string; kind: 'editor' | 'terminal'; executable: string; args: string; adapter: TerminalCustomExternalApp['adapter'] }

function draftOf(app: TerminalCustomExternalApp): Draft {
  return { id: app.id, name: app.name, kind: app.kind ?? 'terminal', executable: app.executable, args: (app.args ?? []).join('\n'), adapter: app.adapter }
}

function appOf(draft: Draft) {
  const args = draft.args.split(/\r?\n/).map((arg) => arg.trim()).filter(Boolean)
  return terminalCustomExternalAppSchema.safeParse({
    id: draft.id, name: draft.name.trim(), executable: draft.executable.trim(), adapter: draft.adapter,
    kind: draft.kind, ...(args.length ? { args } : {}),
  })
}

/** Add or edit an app for "Open in": any editor or terminal the built-in list does not know. */
function OpenTargetSheet({ initial, editing, blocked, onSave, onClose }: {
  initial: Draft
  editing: boolean
  blocked: boolean
  onSave(app: TerminalCustomExternalApp): Promise<boolean>
  onClose(): void
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(initial)
  const [attempted, setAttempted] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const busyRef = React.useRef(false)
  const id = React.useId()
  const result = appOf(draft)
  const invalid = new Set(result.success ? [] : result.error.issues.map((issue) => String(issue.path[0])))
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const close = () => { if (!busyRef.current) { if (dirty) setConfirmDiscard(true); else onClose() } }
  const choose = async () => {
    const chosen = await window.pipilot?.editors.chooseApplication().catch(() => null)
    if (chosen) setDraft((current) => ({ ...current, executable: chosen.path, name: current.name.trim() ? current.name : chosen.name }))
  }
  const save = async () => {
    if (busyRef.current || blocked) return
    setAttempted(true)
    if (!result.success) {
      document.getElementById(`${id}-${[...invalid][0]}`)?.focus()
      return
    }
    busyRef.current = true
    setSaving(true)
    setFailed(false)
    try {
      if (await onSave(result.data)) onClose()
      else setFailed(true)
    } catch { setFailed(true) }
    finally { busyRef.current = false; setSaving(false) }
  }
  return <>
    <SettingsSheet open onOpenChange={(open) => { if (!open) close() }} data-open-target-sheet
      title={t(editing ? 'settings.openWith.editTitle' : 'settings.openWith.addTitle')} description={t('settings.openWith.formDescription')}
      footer={<FormActions onCancel={close} onSave={() => void save()} saving={saving} canSave={!blocked} error={failed ? t('settings.terminal.profiles.form.saveFailed') : null} />}>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <SettingsGroup>
          <SettingsField label={t('settings.openWith.name')} htmlFor={`${id}-name`} error={attempted && invalid.has('name') ? t('settings.terminal.profiles.form.nameError') : undefined}>
            <Input id={`${id}-name`} autoFocus autoComplete="off" value={draft.name} maxLength={128} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-invalid={attempted && invalid.has('name')} />
          </SettingsField>
          <SettingsField label={t('settings.openWith.kind')} htmlFor={`${id}-kind`}>
            <Select value={draft.kind} onValueChange={(value) => setDraft({ ...draft, kind: value === 'editor' ? 'editor' : 'terminal' })}>
              <SelectTrigger id={`${id}-kind`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">{t('settings.openWith.kindEditor')}</SelectItem>
                <SelectItem value="terminal">{t('settings.openWith.kindTerminal')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsField>
          <SettingsField label={t('settings.openWith.application')} htmlFor={`${id}-executable`} hint={t(isMacPlatform() ? 'settings.openWith.applicationHintMac' : 'settings.openWith.applicationHint')}
            error={attempted && invalid.has('executable') ? t('settings.terminal.profiles.form.executableError') : undefined}>
            <div className="flex min-w-0 gap-2">
              <Input id={`${id}-executable`} autoComplete="off" spellCheck={false} className="min-w-0 flex-1 font-mono" value={draft.executable} maxLength={4096}
                onChange={(event) => setDraft({ ...draft, executable: event.target.value })} aria-invalid={attempted && invalid.has('executable')} />
              <Button type="button" variant="outline" size="sm" onClick={() => void choose()}>{t('settings.openWith.choose')}</Button>
            </div>
          </SettingsField>
          <SettingsField label={t('settings.openWith.arguments')} htmlFor={`${id}-args`} hint={t('settings.openWith.argumentsHint')}
            error={attempted && invalid.has('args') ? t('settings.openWith.argumentsError') : undefined}>
            <Textarea id={`${id}-args`} rows={3} spellCheck={false} className="font-mono" value={draft.args} placeholder={draft.kind === 'editor' ? '{path}' : ''}
              onChange={(event) => setDraft({ ...draft, args: event.target.value })} aria-invalid={attempted && invalid.has('args')} />
          </SettingsField>
        </SettingsGroup>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </SettingsSheet>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.form.discardTitle')}</AlertDialogTitle><AlertDialogDescription>{t('settings.terminal.profiles.form.discardDescription')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('app.shutdown.discard')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}

/**
 * The apps of "Open in" (Codex): the default app, the default terminal for
 * "Open in External Terminal", and every editor and terminal, detected or added.
 */
export function OpenWithSettings() {
  const t = useT()
  const nameOf = useOpenTargetName()
  const terminalName = useTerminalAppName()
  const { terminal } = useSettings()
  const { updateTerminal } = useUpdateSettings()
  const saveStatus = useSettingsSaveStatus()
  const { targets, preferred, refresh, setPreferred } = useOpenTargets()
  const [loading, setLoading] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ draft: Draft; existing: boolean } | null>(null)
  const [removing, setRemoving] = React.useState<TerminalCustomExternalApp | null>(null)
  const [removingBusy, setRemovingBusy] = React.useState(false)
  const mounted = React.useRef(true)
  const removeBusyRef = React.useRef(false)
  const busy = saveStatus === 'saving' || removingBusy
  const custom = terminal.externalApps

  const reload = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try { await refresh() } catch { if (mounted.current) setLoadFailed(true) }
    finally { if (mounted.current) setLoading(false) }
  }, [refresh])
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  // Saved apps change what main can open: list again after each save.
  const revision = JSON.stringify(custom)
  React.useEffect(() => { if (saveStatus !== 'saving') void reload() }, [revision, saveStatus, reload])

  const apps = targets.filter((target) => target.group !== 'other')
  const terminals = apps.filter((target): target is Extract<OpenTarget, { group: 'terminal' }> => target.group === 'terminal')
  const selectedTerminal = terminals.find(({ app }) => matchesAppId(app, terminal.defaultExternalAppId))
  const unavailable = terminal.defaultExternalAppId !== null && !loading && !loadFailed && !selectedTerminal?.app.available
  const automatic = terminals.find(({ app }) => app.available && (app.source === 'detected' || app.aliases?.some((id) => id.startsWith('external:detected:'))))
  const choices = targets.filter((target) => isAvailable(target) && !(target.group === 'other' && target.editor.kind === 'file-manager'))

  const saveDefaultTerminal = async (value: string) => {
    const target = terminals.find(({ id }) => id === value)
    const saved = await updateTerminal({
      defaultExternalAppId: value === AUTOMATIC ? null : value,
      defaultExternalAppSnapshot: target ? { id: target.app.id, label: target.app.label, executable: target.app.executable, adapter: target.app.adapter } : null,
    }).catch(() => false)
    if (mounted.current) setSaveFailed(!saved)
  }
  const saveApp = (app: TerminalCustomExternalApp) => updateTerminal({
    externalApps: editing?.existing ? custom.map((item) => item.id === app.id ? app : item) : [...custom, app],
    ...(terminal.defaultExternalAppId === app.id ? app.kind === 'editor'
      ? { defaultExternalAppId: null, defaultExternalAppSnapshot: null }
      : { defaultExternalAppSnapshot: { id: app.id, label: app.name, executable: app.executable, adapter: app.adapter } } : {}),
  })
  const remove = async () => {
    if (!removing || busy || removeBusyRef.current) return
    removeBusyRef.current = true
    setRemovingBusy(true)
    setSaveFailed(false)
    try {
      const saved = await updateTerminal({ externalApps: custom.filter(({ id }) => id !== removing.id), ...(terminal.defaultExternalAppId === removing.id ? { defaultExternalAppId: null, defaultExternalAppSnapshot: null } : {}) })
      if (!mounted.current) return
      if (saved) setRemoving(null)
      else setSaveFailed(true)
    } catch { if (mounted.current) setSaveFailed(true) }
    finally { removeBusyRef.current = false; if (mounted.current) setRemovingBusy(false) }
  }
  const newApp = (): Draft => ({ id: `external:custom:${crypto.randomUUID()}`, name: '', kind: 'editor', executable: '', args: '', adapter: 'generic' })

  return <>
    <SettingsGroup title={t('settings.openWith.title')} info={t('settings.openWith.description')} data-open-with-defaults
      footer={saveFailed && !removing ? <span className="text-destructive" role="alert">{t('settings.terminal.profiles.form.saveFailed')}</span> : undefined}>
      <SettingsRow label={t('settings.openWith.defaultApp')} info={t('settings.openWith.defaultAppDesc')}>
        <Select value={preferred?.id ?? ''} disabled={!choices.length} onValueChange={(value) => { if (value) setPreferred(value) }}>
          <SelectTrigger className="w-56 max-w-full" aria-label={t('settings.openWith.defaultApp')}><SelectValue /></SelectTrigger>
          <SelectContent>{choices.map((target) => <SelectItem key={target.id} value={target.id}>{nameOf(target)}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label={t('settings.openWith.defaultTerminal')} info={t('settings.openWith.defaultTerminalDesc')}
        description={!terminal.defaultExternalAppId && automatic && !loading && !loadFailed ? t('settings.terminal.profiles.automaticResolved', { name: terminalName(automatic.app) }) : undefined}>
        <Select value={selectedTerminal?.id ?? terminal.defaultExternalAppId ?? AUTOMATIC} disabled={busy} onValueChange={(value) => void saveDefaultTerminal(value)}>
          <SelectTrigger className="w-56 max-w-full" aria-label={t('settings.openWith.defaultTerminal')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC}>{t('settings.terminal.profiles.automatic')}</SelectItem>
            {terminals.map((target) => <SelectItem key={target.id} value={target.id} disabled={!target.app.available}>{nameOf(target)}{!target.app.available ? ` · ${t('settings.terminal.profiles.unavailable')}` : ''}</SelectItem>)}
            {terminal.defaultExternalAppId && !selectedTerminal ? <SelectItem value={terminal.defaultExternalAppId} disabled>{terminal.defaultExternalAppSnapshot?.label ?? t('settings.terminal.external.savedDefault')} · {t('settings.terminal.profiles.unavailable')}</SelectItem> : null}
          </SelectContent>
        </Select>
      </SettingsRow>
      {unavailable ? <UnavailableDefaultRow message={t('settings.terminal.external.defaultUnavailable')} busy={busy} onUseAutomatic={() => void saveDefaultTerminal(AUTOMATIC)} /> : null}
    </SettingsGroup>

    <SettingsGroup title={t('settings.openWith.listTitle')} boxRole="list" data-open-with-apps
      actions={<>
        <Button variant="ghost" size="icon-sm" aria-label={t('settings.terminal.profiles.refresh')} title={t('settings.terminal.profiles.refresh')} disabled={loading || busy} onClick={() => void reload()}>
          <TbRefresh aria-hidden className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </Button>
        <Button variant="outline" size="sm" disabled={busy || custom.length >= 64} onClick={() => setEditing({ existing: false, draft: newApp() })}>
          <TbPlus aria-hidden />{t('settings.openWith.add')}
        </Button>
      </>}
      footer={loadFailed ? <span className="text-destructive" role="alert">{t('settings.openWith.loadFailed')}</span>
        : custom.length >= 64 ? t('settings.terminal.external.limit') : undefined}>
      {apps.map((target) => {
        const added = custom.filter((item) => matchesAppId(target.group === 'terminal' ? target.app : target.editor, item.id))
        const editable = added.length === 1 ? added[0] : undefined
        const available = isAvailable(target)
        const isDefault = preferred?.id === target.id
        const isDefaultTerminal = target.group === 'terminal' && matchesAppId(target.app, terminal.defaultExternalAppId)
        const path = target.group === 'terminal' ? target.app.executable : target.editor.path
        return <SettingsListRow key={target.id} data-open-target-row={target.id} disabled={busy}
          icon={<span className="flex size-7 items-center justify-center"><OpenTargetIcon target={target} className={available ? 'size-5' : 'size-5 opacity-50'} /></span>}
          title={nameOf(target)}
          badges={<>
            <SettingsBadge>{t(target.group === 'terminal' ? 'settings.openWith.kindTerminal' : 'settings.openWith.kindEditor')}</SettingsBadge>
            {added.length ? <SettingsBadge>{t('settings.terminal.profiles.sourceCustom')}</SettingsBadge> : null}
            {isDefault || isDefaultTerminal ? <SettingsBadge tone="accent">{t('settings.terminal.profiles.selected')}</SettingsBadge> : null}
          </>}
          subtitle={path ? <span className="font-mono">{path}</span> : undefined}
          status={!available ? <StatusText tone="danger" title={t(target.group === 'terminal' && target.app.unavailableReason === 'unsupported-platform' ? 'settings.terminal.external.unsupportedPlatform' : 'settings.terminal.profiles.executableUnavailable')}>
            {t('settings.terminal.profiles.unavailable')}
          </StatusText> : undefined}
          onOpen={editable ? () => setEditing({ existing: true, draft: draftOf(editable) }) : undefined}
          openLabel={editable ? t('settings.terminal.external.editNamed', { name: target.name }) : undefined}
          menu={<DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={busy} aria-label={t('settings.terminal.profiles.actions', { name: target.name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isDefault || !available} onSelect={() => setPreferred(target.id)}><TbCheck aria-hidden />{t('settings.openWith.makeDefault')}</DropdownMenuItem>
              {target.group === 'terminal' ? <DropdownMenuItem disabled={isDefaultTerminal || !available} onSelect={() => void saveDefaultTerminal(target.id)}><TbCheck aria-hidden />{t('settings.openWith.makeDefaultTerminal')}</DropdownMenuItem> : null}
              {added.map((item) => <React.Fragment key={item.id}>
                {added.length > 1 ? <DropdownMenuLabel>{item.name}</DropdownMenuLabel> : null}
                <DropdownMenuItem onSelect={() => setEditing({ existing: true, draft: draftOf(item) })}><TbPencil aria-hidden />{t('settings.terminal.profiles.edit')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => { setSaveFailed(false); setRemoving(item) }}><TbTrash aria-hidden />{t('settings.terminal.external.remove')}</DropdownMenuItem>
              </React.Fragment>)}
            </DropdownMenuContent>
          </DropdownMenu>} />
      })}
      {!apps.length ? <div data-settings-row role="status" className="px-3 py-8 text-center text-caption text-muted-foreground">
        {t(loading ? 'settings.openWith.loading' : 'settings.openWith.empty')}
      </div> : null}
    </SettingsGroup>

    {editing ? <OpenTargetSheet key={editing.draft.id} initial={editing.draft} editing={editing.existing} blocked={busy} onSave={saveApp} onClose={() => setEditing(null)} /> : null}
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !removeBusyRef.current) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.removeTitle', { name: removing?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t(removing?.id === terminal.defaultExternalAppId ? 'settings.terminal.external.removeDefaultDescription' : 'settings.terminal.external.removeDescription')}</AlertDialogDescription></AlertDialogHeader>
        {saveFailed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.removeFailed')}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={removingBusy}>{t('common.cancel')}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t(removingBusy ? 'settings.redesign.save.saving' : 'settings.terminal.external.remove')}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
