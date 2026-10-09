import { useT } from '@/i18n'
import { parseModelsConfigDocument } from '@/shared/models-config-schema'
import { ConfigFileEditor } from '../ConfigFileEditor'
import type { ModelsManager } from '../useModelsManager'

/** All of models.json at once, for what the provider pages do not show. */
export function ModelsFileEditor({ manager, onDone, onCancel, onDirtyChange }: {
  manager: ModelsManager
  onDone(): void
  onCancel(): void
  onDirtyChange(dirty: boolean): void
}) {
  const t = useT()
  return <ConfigFileEditor draftText={manager.draftText} savedText={manager.snapshot?.content ?? null} onChange={manager.updateDraft}
    path={manager.snapshot?.path || t('settings.models.noPath')} description={t('settings.models.file.description')} label={t('settings.models.file.title')}
    parse={parseModelsConfigDocument} save={manager.saveDraft} onReload={() => void manager.load(true)} onDone={onDone} onCancel={onCancel} onDirtyChange={onDirtyChange} />
}
