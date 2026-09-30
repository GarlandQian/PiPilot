import * as React from 'react'
import { TbQuote, TbMessages } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { MAX_REFERENCE_TEXT, referenceLineRange, type PrecisionReference } from '@/renderer/composer/precision-reference'

type Insert = (references: readonly PrecisionReference[]) => boolean
interface PrecisionContext {
  ownerKey: string
  workspaceId: string | null
  available: boolean
  insert(references: readonly PrecisionReference[]): boolean
  register(key: string, insert: Insert): () => void
  askSideQuestion?: (reference: PrecisionReference) => void
}
const Context = React.createContext<PrecisionContext | null>(null)

export function PrecisionReferencesProvider({ ownerKey, workspaceId, children, askSideQuestion }: {
  ownerKey: string; workspaceId: string | null; children: React.ReactNode; askSideQuestion?: (reference: PrecisionReference) => void
}) {
  const editor = React.useRef<{ key: string; insert: Insert } | null>(null)
  const current = React.useRef(ownerKey)
  current.current = ownerKey
  const [registeredKey, setRegisteredKey] = React.useState<string | null>(null)
  const register = React.useCallback((key: string, insert: Insert) => {
    const registration = { key, insert }
    editor.current = registration
    setRegisteredKey(key)
    return () => {
      if (editor.current !== registration) return
      editor.current = null
      setRegisteredKey(null)
    }
  }, [])
  const insert = React.useCallback((references: readonly PrecisionReference[]) => {
    const target = editor.current
    return Boolean(target && target.key === current.current && references.length &&
      references.every((reference) => reference.ownerKey === target.key) && target.insert(references))
  }, [])
  const value = React.useMemo(() => ({ ownerKey, workspaceId, register, insert, askSideQuestion, available: registeredKey === ownerKey }),
    [ownerKey, workspaceId, register, insert, askSideQuestion, registeredKey])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export const usePrecisionReferences = () => React.useContext(Context)

export function usePrecisionComposer(key: string, insert: Insert, enabled: boolean) {
  const context = usePrecisionReferences()
  const register = context?.register
  React.useEffect(() => enabled ? register?.(key, insert) : undefined, [key, insert, enabled, register])
}

export interface QuoteSource {
  kind: 'message' | 'file' | 'command'
  sourceId: string
  label: string
  path?: string
  revision?: string
  /** Supply only when the selected DOM represents this exact literal text. */
  literal?: string
}

/** One selection listener for the active surface; only snapshots a user selection. */
export function QuoteSelection({ source, children, className, enabled = true }: {
  source: QuoteSource; children: React.ReactNode; className?: string; enabled?: boolean
}) {
  const t = useT()
  const context = usePrecisionReferences()
  const root = React.useRef<HTMLDivElement>(null)
  const [selection, setSelection] = React.useState<PrecisionReference | null>(null)
  const [error, setError] = React.useState(false)
  const ownerKey = context?.ownerKey
  React.useEffect(() => { setSelection(null); setError(false) }, [ownerKey, source.sourceId, source.literal, source.revision])
  const capture = () => {
    const current = window.getSelection()
    const content = root.current
    if (!enabled || !ownerKey || !content || !current?.rangeCount || current.isCollapsed) { setSelection(null); return }
    const range = current.getRangeAt(0)
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) { setSelection(null); return }
    const text = current.toString()
    if (!text.trim()) { setSelection(null); return }
    setError(text.length > MAX_REFERENCE_TEXT)
    if (text.length > MAX_REFERENCE_TEXT) { setSelection(null); return }
    let lines: { startLine: number; endLine: number } | undefined
    const literal = source.literal
    if (literal !== undefined) {
      // Code renderers keep syntax spans in one code element. Ignore toolbar
      // labels/line-number columns; verify exact bytes before claiming a range.
      const element = range.startContainer.parentElement?.closest('code')
      const normalized = literal.replace(/\r\n/gu, '\n')
      if (element && content.contains(element) && element.contains(range.endContainer) &&
        (element.textContent === normalized || element.textContent === `${normalized}\n`)) {
        const prefix = range.cloneRange()
        prefix.selectNodeContents(element)
        prefix.setEnd(range.startContainer, range.startOffset)
        const start = prefix.toString().length
        if (normalized.slice(start, start + text.length) === text) lines = referenceLineRange(normalized, start, start + text.length)
      }
    }
    setSelection({ id: crypto.randomUUID(), ownerKey, kind: source.kind, sourceId: source.sourceId,
      label: source.label, text, ...(source.path ? { path: source.path } : {}), ...(source.revision ? { revision: source.revision } : {}), ...lines })
  }
  return <div className={className} data-precision-source={source.kind}>
    <div ref={root} onPointerUp={capture} onKeyUp={capture}>{children}</div>
    {selection || error ? <div className="my-1 flex items-center gap-2 text-caption" data-precision-quote-action>
      {error ? <span role="alert" className="text-destructive">{t('precision.selectionTooLong')}</span> : <Button variant="secondary" size="xs"
        disabled={!context?.available} onPointerDown={(event) => event.preventDefault()} onClick={() => {
          if (selection && context?.insert([selection])) { setSelection(null); window.getSelection()?.removeAllRanges() }
        }}><TbQuote aria-hidden />{t('precision.quoteSelection')}</Button>}
      {selection && context?.askSideQuestion ? <Button variant="ghost" size="xs" onPointerDown={(event) => event.preventDefault()} onClick={() => {
        context.askSideQuestion?.(selection); setSelection(null); window.getSelection()?.removeAllRanges()
      }}><TbMessages aria-hidden />{t('sideChat.ask')}</Button> : null}
    </div> : null}
  </div>
}
