import * as React from 'react'
import { TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useT, type MessageKey } from '@/i18n'
import type { ProjectAction } from '@/shared/project-workflows'
import { FormActions, SettingsDisclosure, SettingsField, SettingsGroup, SettingsSheet } from '@/components/settings/kit'
import { workflowErrorText } from '@/store/project-workflows'

const PLATFORMS = ['darwin', 'linux', 'win32'] as const

export function blankAction(index: number): ProjectAction {
  return { id: crypto.randomUUID(), name: ['Install', 'Test', 'Dev'][index] ?? 'Action', command: '', cwd: '.', platforms: {} }
}

/** One saved command: its name, what it runs and where, and per-platform variants. */
export function ActionSheet({ open, onOpenChange, initial, isNew, onSave, onDelete }: {
  open: boolean
  onOpenChange(open: boolean): void
  initial: ProjectAction
  isNew: boolean
  /** Saves the action with the project's others; throws when it cannot. */
  onSave(action: ProjectAction): Promise<void>
  onDelete?(): void
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(initial)
  const [platformsOpen, setPlatformsOpen] = React.useState(() => PLATFORMS.some((platform) => initial.platforms[platform]))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [attempted, setAttempted] = React.useState(false)
  React.useEffect(() => {
    if (!open) return
    setDraft(initial); setError(null); setAttempted(false)
    setPlatformsOpen(PLATFORMS.some((platform) => initial.platforms[platform]))
  }, [initial, open])
  const nameMissing = !draft.name.trim()
  const save = async () => {
    setAttempted(true)
    if (nameMissing) return
    setSaving(true); setError(null)
    try {
      const platforms = Object.fromEntries(PLATFORMS.flatMap((platform) => draft.platforms[platform]?.trim() ? [[platform, draft.platforms[platform]]] : []))
      await onSave({ ...draft, name: draft.name.trim(), cwd: draft.cwd.trim() || '.', platforms })
      onOpenChange(false)
    } catch (caught) {
      setError(workflowErrorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return <SettingsSheet open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }} wide data-project-action-sheet
    title={t(isNew ? 'localEnvironment.addAction' : 'localEnvironment.editAction')} description={t('projectActions.description')}
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={() => void save()} saving={saving} error={error}
      leading={onDelete ? <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={saving} onClick={onDelete}>
        <TbTrash aria-hidden />{t('projectActions.remove')}
      </Button> : undefined} />}>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <SettingsGroup>
        <SettingsField label={t('projectActions.name')} htmlFor="project-action-name" error={attempted && nameMissing ? t('localEnvironment.nameRequired') : undefined}>
          <Input id="project-action-name" value={draft.name} maxLength={80} autoFocus={isNew} aria-invalid={(attempted && nameMissing) || undefined}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </SettingsField>
        <SettingsField label={t('projectActions.command')} htmlFor="project-action-command" hint={t('localEnvironment.commandHint')}>
          <Textarea id="project-action-command" value={draft.command} rows={3} spellCheck={false} className="min-h-16 font-mono text-caption"
            onChange={(event) => setDraft({ ...draft, command: event.target.value })} />
        </SettingsField>
        <SettingsField label={t('localEnvironment.cwd')} htmlFor="project-action-cwd" hint={t('localEnvironment.cwdHint')}>
          <Input id="project-action-cwd" value={draft.cwd} placeholder="." spellCheck={false} className="font-mono" onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} />
        </SettingsField>
        <SettingsDisclosure label={t('localEnvironment.platforms')} open={platformsOpen} onOpenChange={setPlatformsOpen}>
          {PLATFORMS.map((platform) => <SettingsField key={platform} label={t(`localEnvironment.platform.${platform}` as MessageKey)} htmlFor={`project-action-${platform}`}
            hint={platform === 'win32' ? t('localEnvironment.platformsHint') : undefined}>
            <Textarea id={`project-action-${platform}`} value={draft.platforms[platform] ?? ''} rows={2} spellCheck={false} className="min-h-12 font-mono text-caption"
              placeholder={draft.command.split('\n')[0] || undefined}
              onChange={(event) => setDraft({ ...draft, platforms: { ...draft.platforms, [platform]: event.target.value } })} />
          </SettingsField>)}
        </SettingsDisclosure>
      </SettingsGroup>
      <button type="submit" hidden aria-hidden tabIndex={-1} />
    </form>
  </SettingsSheet>
}
