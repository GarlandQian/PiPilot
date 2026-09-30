import * as React from 'react'
import { TbArrowUp, TbLoader2, TbPlayerStop, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { SideConversationSnapshot } from '@/shared/side-conversations'
import type { PrecisionReference } from '@/renderer/composer/precision-reference'

export interface SideQuestionRequest { id: string; scope: ConversationScope; parentSessionId: string; reference: PrecisionReference }
interface SideThread extends SideQuestionRequest { snapshot?: SideConversationSnapshot; text: string; busy: boolean; error?: string; submission?: { requestId: string; text: string } }
const running = (value?: SideConversationSnapshot) => value?.status === 'starting' || value?.status === 'running'
const errorText = (value: unknown) => value && typeof value === 'object' && 'message' in value ? String(value.message) : String(value)

/** Recent side questions are independent official sessions; closing a view never aborts one. */
export function SideConversationsPanel({ request, ownerKey, ready, visible }: {
  request: SideQuestionRequest; ownerKey: string; ready: boolean; visible: boolean
}) {
  const t = useT()
  const [threads, setThreads] = React.useState<SideThread[]>([])
  const threadsRef = React.useRef(threads)
  threadsRef.current = threads
  const [selected, setSelected] = React.useState(request.id)
  const alive = React.useRef(true)
  const requests = React.useRef(new Set<string>())
  const accepted = React.useRef(new Map<string, string>())
  const viewport = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(true)
  const thread = threads.find((item) => item.id === selected)
  const update = React.useCallback((id: string, patch: Partial<SideThread>) => {
    if (alive.current) setThreads((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }, [])
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // Releasing the view retains any active turn until Main saves its answer.
      for (const sideId of accepted.current.values()) void window.pipilot?.sideConversations.release(sideId).catch(() => undefined)
      accepted.current.clear()
    }
  }, [])
  React.useEffect(() => {
    if (requests.current.has(request.id)) return
    requests.current.add(request.id)
    setThreads((items) => [...items, { ...request, text: '', busy: false }])
    setSelected(request.id)
  }, [request])
  // Evict only completed/unsubmitted views. A running question remains reachable.
  React.useEffect(() => {
    if (threads.length <= 8) return
    const expired = threads.find((item) => item.id !== selected && !item.busy && !running(item.snapshot) && !item.text)
    if (!expired) return
    if (expired.snapshot) void window.pipilot!.sideConversations.release(expired.snapshot.sideId).then(() => accepted.current.delete(expired.id), () => undefined)
    setThreads((items) => items.filter((item) => item.id !== expired.id))
  }, [threads, selected])
  React.useEffect(() => {
    if (!visible || !thread?.snapshot || !running(thread.snapshot)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const id = thread.id, sideId = thread.snapshot.sideId
    const poll = async () => {
      try {
        const snapshot = await window.pipilot!.sideConversations.get(sideId)
        if (!cancelled) update(id, { snapshot, error: undefined })
      } catch (error) { if (!cancelled) update(id, { error: errorText(error) }) }
      if (!cancelled) timer = setTimeout(() => void poll(), 600)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [visible, thread?.id, thread?.snapshot?.sideId, thread?.snapshot?.status, update])
  React.useEffect(() => { following.current = true }, [selected])
  React.useEffect(() => {
    if (visible && following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [visible, selected, thread?.snapshot?.messages])
  async function submit() {
    if (!thread || thread.busy || running(thread.snapshot) || !thread.text.trim()) return
    if (!thread.snapshot && (!ready || thread.reference.ownerKey !== ownerKey)) return
    const id = thread.id
    const submission = thread.submission?.text === thread.text ? thread.submission : { requestId: crypto.randomUUID(), text: thread.text }
    update(id, { busy: true, error: undefined, submission })
    try {
      const snapshot = thread.snapshot
        ? await window.pipilot!.sideConversations.send({ sideId: thread.snapshot.sideId, text: submission.text, requestId: submission.requestId })
        : await window.pipilot!.sideConversations.create({ scope: thread.scope, parentSessionId: thread.parentSessionId, reference: thread.reference, question: submission.text, requestId: submission.requestId })
      if (!alive.current) { void window.pipilot!.sideConversations.release(snapshot.sideId).catch(() => undefined); return }
      accepted.current.set(id, snapshot.sideId)
      update(id, { snapshot, text: '', busy: false, submission: undefined })
    } catch (error) { update(id, { error: errorText(error), busy: false }) }
  }
  async function closeThread() {
    if (!thread || thread.busy) return
    const id = thread.id
    update(id, { busy: true, error: undefined })
    try {
      if (thread.snapshot) await window.pipilot!.sideConversations.release(thread.snapshot.sideId)
      accepted.current.delete(id)
      if (!alive.current) return
      setThreads((items) => items.filter((item) => item.id !== id))
      setSelected((current) => current === id ? threadsRef.current.find((item) => item.id !== id)?.id ?? '' : current)
    } catch (error) { update(id, { error: errorText(error), busy: false }) }
  }
  return <div className="flex h-full min-h-0 flex-col" data-side-conversations>
    <div className="space-y-2 border-b border-border p-3">
      <p className="text-caption text-muted-foreground">{t('sideChat.description')}</p>
      {threads.length ? <div className="flex gap-1">
        <select aria-label={t('sideChat.recent')} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-caption" value={selected} onChange={(event) => setSelected(event.target.value)}>
          {threads.map((item) => <option key={item.id} value={item.id}>{item.reference.label} · {t(item.snapshot ? `sideChat.state.${item.snapshot.status}` : 'sideChat.state.draft')}</option>)}
        </select>
        <Button variant="ghost" size="icon-sm" disabled={thread?.busy} onClick={() => void closeThread()} aria-label={t('sideChat.close')} title={t('sideChat.close')}><TbX aria-hidden /></Button>
      </div> : null}
    </div>
    {thread ? <>
      <div ref={viewport} className="scroll-slim min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3" onScroll={(event) => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64 }}>
        <details className="mb-4 rounded-md border px-3 py-2"><summary className="cursor-pointer break-words text-caption">{thread.reference.label}</summary><div className="mt-2"><MarkdownContent markdown={thread.reference.text} /></div></details>
        <div className="space-y-4" role="log" aria-label={t('sideChat.messages')}>
          {thread.snapshot?.messages.map((message, index) => <div key={index} className={message.role === 'user' ? 'ml-5 rounded-lg bg-accent p-3' : 'min-w-0'}><MarkdownContent markdown={message.text} streaming={message.partial} /></div>)}
        </div>
        {thread.snapshot ? <p role="status" className="mt-3 flex items-center gap-2 text-caption text-muted-foreground">{running(thread.snapshot) ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t(`sideChat.state.${thread.snapshot.status}`)}</p> : null}
        {thread.error || thread.snapshot?.error ? <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-caption text-destructive">{thread.error || thread.snapshot?.error}</p> : null}
      </div>
      <div className="space-y-2 border-t border-border p-3">
        {!thread.snapshot && (!ready || thread.reference.ownerKey !== ownerKey) ? <p role="status" className="text-caption text-muted-foreground">{t('sideChat.returnToParent')}</p> : null}
        <Textarea aria-label={t('sideChat.question')} placeholder={t('sideChat.question')} value={thread.text} maxLength={20_000} disabled={thread.busy} onChange={(event) => update(thread.id, { text: event.target.value })}
          onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() } }} className="max-h-44 min-h-20 resize-y" />
        <div className="flex justify-end">
          {running(thread.snapshot) ? <Button size="sm" variant="outline" disabled={thread.busy} onClick={() => {
            update(thread.id, { busy: true }); void window.pipilot!.sideConversations.abort(thread.snapshot!.sideId).then((snapshot) => update(thread.id, { snapshot, busy: false }), (error) => update(thread.id, { error: errorText(error), busy: false }))
          }}><TbPlayerStop aria-hidden />{t('sideChat.stop')}</Button> : <Button size="sm" disabled={thread.busy || !thread.text.trim() || (!thread.snapshot && (!ready || thread.reference.ownerKey !== ownerKey)) || thread.snapshot?.released} onClick={() => void submit()}><TbArrowUp aria-hidden />{t('sideChat.send')}</Button>}
        </div>
      </div>
    </> : <p className="m-auto px-4 text-center text-caption text-muted-foreground">{t('sideChat.empty')}</p>}
  </div>
}
