import * as React from 'react'
import { TbCopy, TbDownload, TbExternalLink, TbGitFork, TbMessages, TbPencil, TbQuote } from 'react-icons/tb'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { usePrecisionReferences, type QuoteSource } from '@/components/precision/PrecisionReferences'
import { messageReference, messageSelectionText, messageSnapshotIsCurrent } from '@/renderer/composer/message-context'
import { MAX_REFERENCE_TEXT } from '@/renderer/composer/precision-reference'
import { useT } from '@/i18n'

interface MessageActions {
  source: QuoteSource
  markdown: string
  onEdit?: () => void
  editDisabled?: boolean
  onFork?: () => void
  forkDisabled?: boolean
  onExport?: () => void
  exportLabel?: 'export.message' | 'export.response'
}

interface MessageMenuContext extends MessageActions {
  root: React.RefObject<HTMLDivElement | null>
  copyFeedback(state: 'copied' | 'failed'): void
}
const MessageContext = React.createContext<MessageMenuContext | null>(null)

/** Nested code and link menus share the containing message's snapshot and actions. */
export function MessageContextMenu({ children, ...actions }: MessageActions & { children: React.ReactNode }) {
  const t = useT()
  const root = React.useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = React.useState<'copied' | 'failed' | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copyFeedback = React.useCallback((state: 'copied' | 'failed') => {
    setFeedback(state)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback(null), 1_400)
  }, [])
  const value = React.useMemo(() => ({ ...actions, root, copyFeedback }), [actions.source, actions.markdown, actions.onEdit, actions.editDisabled, actions.onFork, actions.forkDisabled, actions.onExport, actions.exportLabel, copyFeedback])
  return <MessageContext.Provider value={value}>
    <MessageTargetMenu><div ref={root} tabIndex={0} className="min-w-0 rounded-sm outline-none focus-visible:focus-ring" data-message-context>{children}</div></MessageTargetMenu>
    {/* Status text must stay outside selectable Markdown, especially inside links. */}
    {feedback ? <span role="status" className={feedback === 'failed' ? 'block text-caption text-destructive' : 'sr-only'}>{t(feedback === 'failed' ? 'chat.response.copyFailed' : 'chat.response.copied')}</span> : null}
  </MessageContext.Provider>
}

interface MessageTarget {
  code?: string
  link?: { href: string; open(): void }
}

export function MessageTargetMenu({ children, target }: { children: React.ReactElement; target?: MessageTarget }) {
  const message = React.useContext(MessageContext)
  const references = usePrecisionReferences()
  const t = useT()
  const keepFocus = React.useRef(false)
  const [snapshot, setSnapshot] = React.useState<{ ownerKey?: string; sourceId: string; selection: string | null; markdown: string; target?: MessageTarget } | null>(null)
  if (!message) return children

  const current = messageSnapshotIsCurrent(snapshot, references?.ownerKey, message.source.sourceId)
  const selection = snapshot?.selection
  const text = selection ?? snapshot?.markdown ?? ''
  const reference = current ? messageReference(message.source, snapshot?.ownerKey, text) : null
  const copy = (value: string) => {
    if (!current) return
    void navigator.clipboard.writeText(value).then(() => message.copyFeedback('copied')).catch(() => message.copyFeedback('failed'))
  }
  const capture = (event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) {
      event.preventDefault()
      return
    }
    // An inner code/link trigger owns the gesture, including Radix's touch long-press.
    event.stopPropagation()
    setSnapshot({ ownerKey: references?.ownerKey, sourceId: message.source.sourceId,
      selection: message.root.current ? messageSelectionText(message.root.current, window.getSelection()) : null,
      markdown: message.markdown, target })
  }
  return <ContextMenu key={`${references?.ownerKey}:${message.source.sourceId}`}>
    <ContextMenuTrigger asChild onContextMenu={capture} onPointerDown={(event) => {
      // Radix opens a touch/pen menu from its timer without dispatching contextmenu.
      if (event.pointerType !== 'mouse') capture(event)
    }}>{children}</ContextMenuTrigger>
    <ContextMenuContent onCloseAutoFocus={(event) => {
      if (keepFocus.current) { keepFocus.current = false; event.preventDefault() }
    }}>
      {snapshot?.target?.link ? <>
        <ContextMenuItem disabled={!current} onSelect={() => current && snapshot.target?.link?.open()}><TbExternalLink aria-hidden />{t('chat.context.openLink')}</ContextMenuItem>
        <ContextMenuItem disabled={!current} onSelect={() => copy(snapshot.target!.link!.href)}><TbCopy aria-hidden />{t('chat.context.copyLink')}</ContextMenuItem>
        <ContextMenuSeparator />
      </> : null}
      {snapshot?.target?.code !== undefined ? <>
        <ContextMenuItem disabled={!current} onSelect={() => copy(snapshot.target!.code!)}><TbCopy aria-hidden />{t('chat.context.copyCode')}</ContextMenuItem>
        <ContextMenuSeparator />
      </> : null}
      <ContextMenuItem disabled={!current || !text.trim()} onSelect={() => copy(text)}><TbCopy aria-hidden />{t(selection ? 'chat.context.copySelection' : 'chat.context.copyMessage')}</ContextMenuItem>
      <ContextMenuItem disabled={!reference || !references?.available} onSelect={() => {
        if (reference && references?.insert([reference])) {
          keepFocus.current = true
          window.getSelection()?.removeAllRanges()
        }
      }}><TbQuote aria-hidden />{t(selection ? 'precision.quoteSelection' : 'chat.context.quoteMessage')}</ContextMenuItem>
      {selection && references?.askSideQuestion ? <ContextMenuItem disabled={!reference} onSelect={() => {
        if (!reference) return
        keepFocus.current = true
        references.askSideQuestion?.(reference)
        window.getSelection()?.removeAllRanges()
      }}><TbMessages aria-hidden />{t('sideChat.ask')}</ContextMenuItem> : null}
      {text.length > MAX_REFERENCE_TEXT ? <p role="status" className="max-w-64 px-2 py-1 text-micro text-muted-foreground">{t('precision.selectionTooLong')}</p> : null}
      {!selection && (message.onEdit || message.onFork || message.onExport) ? <ContextMenuSeparator /> : null}
      {!selection && message.onEdit ? <ContextMenuItem disabled={!current || message.editDisabled} onSelect={() => {
        if (!current || message.editDisabled) return
        keepFocus.current = true
        message.onEdit?.()
      }}><TbPencil aria-hidden />{t('chat.context.editQuestion')}</ContextMenuItem> : null}
      {!selection && message.onFork ? <ContextMenuItem disabled={!current || message.forkDisabled} onSelect={() => {
        if (!current || message.forkDisabled) return
        keepFocus.current = true
        message.onFork?.()
      }}><TbGitFork aria-hidden />{t('chat.context.forkQuestion')}</ContextMenuItem> : null}
      {!selection && message.onExport ? <ContextMenuItem disabled={!current} onSelect={() => current && message.onExport?.()}><TbDownload aria-hidden />{t(message.exportLabel ?? 'export.message')}</ContextMenuItem> : null}
    </ContextMenuContent>
  </ContextMenu>
}
