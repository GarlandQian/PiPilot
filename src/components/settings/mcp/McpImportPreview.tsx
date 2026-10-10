import type * as React from 'react'
import { TbAlertTriangle } from 'react-icons/tb'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { McpImportNote } from '@/shared/mcp-import'
import { transportOf } from './mcp-editor-model'
import { McpServerIcon } from './McpServerEditor'

export interface McpImportCandidate {
  key: string
  name: string
  definition: Record<string, unknown>
  notes: readonly McpImportNote[]
}

export type McpClashPolicy = 'skip' | 'replace'

function endpoint(definition: Record<string, unknown>) {
  if (typeof definition.command === 'string') return [definition.command, ...(Array.isArray(definition.args) ? definition.args : [])].join(' ')
  return typeof definition.url === 'string' ? definition.url : ''
}

/** The servers to add: the chosen ones, one per name, and same-named existing ones only when replacing. */
export function chosenServers(candidates: readonly McpImportCandidate[], selected: ReadonlySet<string>, existing: readonly string[], policy: McpClashPolicy) {
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const name = candidate.name.toLowerCase()
    if (!selected.has(candidate.key) || seen.has(name)) return false
    if (taken.has(name) && policy === 'skip') return false
    seen.add(name)
    return true
  })
}

export function McpNoteText({ note }: { note: McpImportNote }) {
  const t = useT()
  switch (note.kind) {
    case 'sse': return <>{t('settings.mcp.import.note.sse')}</>
    case 'dropped': return <>{t('settings.mcp.import.note.dropped', { fields: note.fields.join(', ') })}</>
    case 'input-variables': return <>{t('settings.mcp.import.note.inputs')}</>
    case 'renamed': return <>{t('settings.mcp.import.note.renamed', { from: note.from })}</>
  }
}

export function McpClashSelect({ value, onChange }: { value: McpClashPolicy; onChange(value: McpClashPolicy): void }) {
  const t = useT()
  return <label className="flex min-w-0 flex-wrap items-center gap-2 text-caption text-muted-foreground">
    {t('settings.mcp.import.clash')}
    <select className="mac-select" value={value} aria-label={t('settings.mcp.import.clash')} onChange={(event) => onChange(event.target.value === 'replace' ? 'replace' : 'skip')}>
      <option value="skip">{t('settings.mcp.import.skip')}</option>
      <option value="replace">{t('settings.mcp.import.replace')}</option>
    </select>
  </label>
}

/** Servers found in pasted text or another app, each with a checkbox and what changes on the way in. */
export function McpImportPreview({ candidates, selected, onToggle, existing, policy }: {
  candidates: readonly McpImportCandidate[]
  selected: ReadonlySet<string>
  onToggle(key: string, on: boolean): void
  existing: readonly string[]
  policy: McpClashPolicy
}) {
  const t = useT()
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  return <div className="settings-group min-w-0" role="list">
    {candidates.map((candidate) => {
      const clash = taken.has(candidate.name.toLowerCase())
      return <label key={candidate.key} role="listitem" data-settings-row data-mcp-import-candidate={candidate.name} className="flex min-w-0 cursor-default items-start gap-3 px-3 py-2.5" style={{ '--settings-row-inset': '80px' } as React.CSSProperties}>
        <Checkbox className="mt-2" checked={selected.has(candidate.key)} onCheckedChange={(on) => onToggle(candidate.key, on === true)} aria-label={candidate.name} />
        <McpServerIcon transport={transportOf(candidate.definition)} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="break-all font-mono text-app font-medium">{candidate.name}</span>
            {clash ? <span className={cn('rounded-full px-1.5 text-micro', policy === 'replace' ? 'bg-warning/14 text-warning' : 'bg-fill-strong text-muted-foreground')}>
              {t(policy === 'replace' ? 'settings.mcp.import.willReplace' : 'settings.mcp.import.willSkip')}</span> : null}
          </span>
          <span className="mt-0.5 block truncate font-mono text-caption text-muted-foreground" title={endpoint(candidate.definition)}>{endpoint(candidate.definition)}</span>
          {candidate.notes.map((note, index) => <span key={index} className="mt-1 flex items-start gap-1 text-micro text-warning">
            <TbAlertTriangle className="mt-px size-3 shrink-0" aria-hidden /><McpNoteText note={note} />
          </span>)}
        </span>
      </label>
    })}
  </div>
}
