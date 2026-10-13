import * as React from 'react'
import { TbArrowUp, TbArrowUpRight, TbBrain, TbLoader2, TbPlayerStop, TbTool, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { useT } from '@/i18n'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { LocalPiModel, LocalPiThinkingLevel } from '@/shared/local-pi'
import type { ComposerSendShortcut } from '@/shared/settings'
import type { SideConversationConfiguration, SideConversationSnapshot, SideConversationTimelineItem } from '@/shared/side-conversations'
import { isComposerSendShortcut } from '@/renderer/composer/composer-submission'
import { modelThinkingSelection } from '@/renderer/composer/model-thinking'
import { sideConversationsStore as views, type SideQuestionRequest } from '@/renderer/side-conversations-store'
import { isSideQuestionInteraction, SideQuestionInteraction } from './SideQuestionInteraction'

export type { SideQuestionRequest } from '@/renderer/side-conversations-store'
const running = (value?: SideConversationSnapshot) => value?.status === 'starting' || value?.status === 'running'
const errorText = (value: unknown) => value && typeof value === 'object' && 'message' in value ? String(value.message) : String(value)

function SideTimelineItem({ item }: { item: SideConversationTimelineItem }) {
  const t = useT()
  if (item.kind === 'thinking' || item.kind === 'tool') return <details className="min-w-0 rounded-lg border border-border/60 px-3 py-2" data-side-timeline={item.kind}>
    <summary className="cursor-pointer text-caption text-muted-foreground"><span className="ml-1 inline-flex items-center gap-2">
      {item.kind === 'thinking' ? <TbBrain aria-hidden /> : <TbTool aria-hidden />}
      {item.kind === 'thinking' ? t('sideChat.thinking') : item.toolName}
      {item.status === 'running' ? <TbLoader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" /> : null}
      {item.status === 'failed' ? <span className="text-destructive">{t('sideChat.state.failed')}</span> : null}
    </span></summary>
    {item.arguments ? <pre className="scroll-slim my-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-micro text-muted-foreground">{item.arguments}</pre> : null}
    {item.text ? <div className="mt-2 min-w-0"><MarkdownContent markdown={item.text} streaming={item.partial} /></div> : null}
  </details>
  return <div data-side-message={item.kind} className={item.kind === 'user' ? 'ml-auto w-fit max-w-[90%] rounded-2xl bg-muted px-3 py-1.5' : 'min-w-0'}><MarkdownContent markdown={item.text} streaming={item.partial} /></div>
}

/** Independent official conversations; panel lifetime never owns their drafts or execution. */
export function SideConversationsPanel({ request, ownerKey, scope, parentSessionId, ready, visible, parentModel, models: parentModels, thinkingLevel, thinkingLevels, sendShortcut, onOpenConversation }: {
  request: SideQuestionRequest | null; ownerKey: string; scope: ConversationScope; parentSessionId: string | null
  ready: boolean; visible: boolean; parentModel: LocalPiModel | null; models: readonly LocalPiModel[]
  thinkingLevel: LocalPiThinkingLevel | null; thinkingLevels: readonly LocalPiThinkingLevel[]; sendShortcut: ComposerSendShortcut
  onOpenConversation(scope: ConversationScope, sessionId: string): Promise<void>
}) {
  const t = useT()
  const state = React.useSyncExternalStore(views.subscribe, views.getSnapshot)
  const threads = state.threads.filter((item) => item.reference.ownerKey === ownerKey)
  const selected = state.selected[ownerKey] ?? threads[0]?.id
  const thread = threads.find((item) => item.id === selected)
  const [listError, setListError] = React.useState<string | null>(null)
  const [refresh, setRefresh] = React.useState(0)
  const viewport = React.useRef<HTMLDivElement>(null), following = React.useRef(true)
  const scopeKey = JSON.stringify(scope)
  React.useEffect(() => { if (request?.reference.ownerKey === ownerKey) views.add(request) }, [request, ownerKey])
  React.useEffect(() => {
    if (!visible || !parentSessionId) return
    let cancelled = false
    setListError(null)
    void window.pipilot!.sideConversations.list({ scope, parentSessionId }).then((snapshots) => {
      if (!cancelled) views.merge(ownerKey, snapshots)
    }, (error) => { if (!cancelled) setListError(errorText(error)) })
    return () => { cancelled = true }
  }, [visible, ownerKey, parentSessionId, scopeKey, refresh])
  React.useEffect(() => {
    if (!visible || !thread?.snapshot) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const id = thread.id, sideId = thread.snapshot.sideId
    const poll = async () => {
      try {
        const snapshot = await window.pipilot!.sideConversations.get(sideId)
        if (!cancelled) {
          const current = views.getSnapshot().threads.find((item) => item.id === id)
          // Reopening may await an extension question before send/configure resolves.
          // Keep that question answerable while preserving the in-flight model operation.
          if (current?.busy && current.snapshot) views.update(id, { snapshot: { ...current.snapshot, uiRequests: snapshot.uiRequests, status: snapshot.status, error: snapshot.error } })
          else views.update(id, { snapshot, error: undefined })
        }
      } catch (error) { if (!cancelled) views.update(id, { error: errorText(error) }) }
      if (!cancelled) timer = setTimeout(() => void poll(), 800)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [visible, thread?.id, thread?.snapshot?.sideId])
  React.useEffect(() => { following.current = true }, [selected])
  React.useEffect(() => {
    if (visible && following.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [visible, selected, thread?.snapshot?.timeline, thread?.snapshot?.uiRequests])
  const snapshot = thread?.snapshot
  const configuration = thread?.configuration ?? snapshot?.configuration
  const models = snapshot?.models.length ? snapshot.models : parentModels
  const currentModel = configuration ? models.find((model) => model.provider === configuration.provider && model.id === configuration.modelId) ?? null : snapshot ? snapshot.model : parentModel
  const pendingModel = currentModel?.id !== (snapshot?.model ?? parentModel)?.id || currentModel?.provider !== (snapshot?.model ?? parentModel)?.provider
  const thinkingPreview = modelThinkingSelection(currentModel, configuration?.thinkingLevel ?? snapshot?.thinkingLevel ?? thinkingLevel)
  const levels = pendingModel ? thinkingPreview.levels : snapshot ? snapshot.thinkingLevels : thinkingLevels
  const currentThinking = pendingModel ? thinkingPreview.selected : configuration?.thinkingLevel ?? snapshot?.thinkingLevel ?? thinkingLevel
  const interactions = snapshot?.uiRequests.filter(isSideQuestionInteraction) ?? []
  const initialAvailable = ready && thread?.reference.ownerKey === ownerKey
  const canSend = Boolean(thread && !thread.busy && !running(snapshot) && !interactions.length && thread.text.trim() && (snapshot || initialAvailable))

  async function configure(next: SideConversationConfiguration) {
    if (!thread || thread.busy) return
    if (!snapshot) { views.update(thread.id, { configuration: next }); return }
    views.update(thread.id, { busy: true, error: undefined })
    try {
      const updated = await window.pipilot!.sideConversations.configure({ sideId: snapshot.sideId, configuration: next })
      views.update(thread.id, { snapshot: updated, configuration: undefined, busy: false })
    } catch (error) { views.update(thread.id, { error: errorText(error), busy: false }); throw error }
  }
  async function submit() {
    if (!canSend || !thread) return
    const id = thread.id
    const submission = thread.submission?.text === thread.text && JSON.stringify(thread.submission.configuration) === JSON.stringify(configuration ?? undefined)
      ? thread.submission : { requestId: crypto.randomUUID(), text: thread.text, configuration: configuration ?? undefined }
    views.update(id, { busy: true, error: undefined, submission })
    try {
      const updated = snapshot
        ? await window.pipilot!.sideConversations.send({ sideId: snapshot.sideId, ...submission })
        : await window.pipilot!.sideConversations.create({ scope: thread.scope, parentSessionId: thread.parentSessionId, reference: thread.reference, question: submission.text, requestId: submission.requestId, configuration: submission.configuration })
      views.accept(id, updated, submission.text)
    } catch (error) { views.update(id, { error: errorText(error), busy: false }) }
  }
  async function act(action: () => Promise<SideConversationSnapshot | void>, close = false) {
    if (!thread || thread.busy) return
    const id = thread.id
    views.update(id, { busy: true, error: undefined })
    try {
      const updated = await action()
      if (close) views.close(id)
      else views.update(id, { ...(updated ? { snapshot: updated } : {}), busy: false })
    } catch (error) { views.update(id, { error: errorText(error), busy: false }) }
  }
  async function answerOrStop(action: () => Promise<SideConversationSnapshot>) {
    if (!thread || thread.interactionBusy) return
    const id = thread.id
    views.update(id, { interactionBusy: true, error: undefined })
    try { views.update(id, { snapshot: await action(), interactionBusy: false }) }
    catch (error) { views.update(id, { error: errorText(error), interactionBusy: false }) }
  }
  const timeline = snapshot?.timeline.length ? snapshot.timeline : snapshot?.messages.map((message, index) => ({ id: 'message-' + index, kind: message.role, text: message.text, partial: message.partial })) ?? []
  return <div className="flex h-full min-h-0 flex-col" data-side-conversations>
    <div className="space-y-2 border-b border-border p-3">
      <p className="text-caption text-muted-foreground">{t('sideChat.description')}</p>
      {threads.length ? <div className="flex gap-1">
        <select aria-label={t('sideChat.recent')} className="mac-select min-w-0 flex-1" value={selected} onChange={(event) => views.select(ownerKey, event.target.value)}>
          {threads.map((item) => <option key={item.id} value={item.id}>{(item.snapshot?.messages.find((message) => message.role === 'user')?.text ?? item.reference.label).slice(0, 80)} · {t(item.snapshot ? ('sideChat.state.' + item.snapshot.status) as 'sideChat.state.running' : 'sideChat.state.draft')}</option>)}
        </select>
        <Button variant="ghost" size="icon-sm" disabled={thread?.busy} onClick={() => void act(async () => { if (snapshot) await window.pipilot!.sideConversations.release(snapshot.sideId) }, true)} aria-label={t('sideChat.close')} title={t('sideChat.close')}><TbX aria-hidden /></Button>
      </div> : null}
      {snapshot?.sessionId ? <Button size="xs" variant="ghost" disabled={thread?.busy} onClick={() => void act(() => onOpenConversation(snapshot.scope, snapshot.sessionId!))}><TbArrowUpRight aria-hidden />{t('sideChat.openConversation')}</Button> : null}
      {listError ? <div className="text-caption text-destructive" role="alert">{listError}<Button size="xs" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>{t('common.retry')}</Button></div> : null}
    </div>
    {thread ? <>
      <div ref={viewport} className="scroll-slim min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3" onScroll={(event) => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64 }}>
        <details className="mb-4 rounded-lg border border-border px-3 py-2"><summary className="cursor-pointer break-words text-caption font-medium">{t('sideChat.source')} · {thread.reference.label}</summary><div className="mt-2"><MarkdownContent markdown={thread.reference.text} /></div></details>
        <div className="space-y-4" role="log" aria-label={t('sideChat.messages')}>{timeline.map((item) => <SideTimelineItem key={item.id} item={item} />)}</div>
        {snapshot ? <p role="status" className="mt-3 flex items-center gap-2 text-caption text-muted-foreground">{running(snapshot) ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t(('sideChat.state.' + snapshot.status) as 'sideChat.state.running')}</p> : null}
        {interactions.length ? <div className="mt-4 space-y-3">{interactions.map((question) => <SideQuestionInteraction key={question.id} request={question} busy={thread.interactionBusy ?? false}
          onRespond={(response) => void answerOrStop(() => window.pipilot!.sideConversations.respond({ sideId: snapshot!.sideId, response }))} />)}</div> : null}
        {thread.error || snapshot?.error ? <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-caption text-destructive">{thread.error || snapshot?.error}</p> : null}
      </div>
      <div className="space-y-2 border-t border-border p-3">
        {!snapshot && !initialAvailable ? <p className="text-caption text-muted-foreground">{t('sideChat.returnToParent')}</p> : null}
        <Textarea aria-label={t('sideChat.question')} placeholder={t('sideChat.question')} value={thread.text} maxLength={20_000} onChange={(event) => views.update(thread.id, { text: event.target.value })}
          onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.keyCode !== 229 && isComposerSendShortcut(event, sendShortcut) && canSend) { event.preventDefault(); void submit() } }} className="max-h-44 min-h-20 resize-y rounded-[14px]" />
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0 flex-1"><ModelPicker operationOwnerKey={'side:' + thread.id} models={models} selected={currentModel} thinkingLevels={levels} selectedThinkingLevel={currentThinking}
            connected={Boolean(snapshot || initialAvailable)} loading={thread.busy || snapshot?.status === 'starting'}
            onSelect={(provider, modelId) => configure({ provider, modelId, ...(currentThinking ? { thinkingLevel: currentThinking } : {}) })}
            onThinkingSelect={(level) => currentModel ? configure({ provider: currentModel.provider, modelId: currentModel.id, thinkingLevel: level }) : undefined} /></div>
          {running(snapshot) || interactions.length ? <Button size="sm" variant="outline" disabled={thread.interactionBusy} onClick={() => void answerOrStop(() => window.pipilot!.sideConversations.abort(snapshot!.sideId))}><TbPlayerStop aria-hidden />{t('sideChat.stop')}</Button>
            : <Button size="sm" disabled={!canSend} onClick={() => void submit()}><TbArrowUp aria-hidden />{t('sideChat.send')}</Button>}
        </div>
        {running(snapshot) ? <p className="text-micro text-muted-foreground">{t('sideChat.nextModel')}</p> : null}
      </div>
    </> : <p className="m-auto px-4 text-center text-caption text-muted-foreground">{t('sideChat.empty')}</p>}
  </div>
}
