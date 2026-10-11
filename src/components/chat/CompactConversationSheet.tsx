import * as React from 'react'
import { TbAlertTriangle } from 'react-icons/tb'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, SettingsField, SettingsSheet } from '@/components/settings/kit'
import { useT } from '@/i18n'

/**
 * Pi's `/compact [instructions]`: what the summary should keep. Compaction
 * stops a reply in progress, so that is said before it happens.
 */
export function CompactConversationSheet({ open, streaming, onOpenChange, onCompact }: {
  open: boolean
  streaming: boolean
  onOpenChange(open: boolean): void
  onCompact(instructions: string | undefined): void
}) {
  const t = useT()
  const [instructions, setInstructions] = React.useState('')
  const fieldId = React.useId()
  React.useEffect(() => { if (open) setInstructions('') }, [open])
  const submit = () => {
    onOpenChange(false)
    onCompact(instructions.trim() || undefined)
  }
  return <SettingsSheet open={open} onOpenChange={onOpenChange} data-compact-sheet title={t('header.compact')} description={t('compact.description')}
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={submit} saveLabel={t('compact.confirm')} />}>
    <div className="space-y-3">
      {streaming ? <p role="alert" className="flex items-start gap-2 rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption">
        <TbAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />{t('compact.interrupts')}
      </p> : null}
      <SettingsField label={t('compact.instructions')} htmlFor={fieldId} hint={t('compact.instructionsHint')}>
        <Textarea id={fieldId} rows={4} maxLength={4_000} value={instructions} placeholder={t('compact.placeholder')}
          onChange={(event) => setInstructions(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() } }} />
      </SettingsField>
    </div>
  </SettingsSheet>
}
