import type * as React from 'react'
import { TbLoader2 } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ResponsePresentation, ResponsePresentationSegment } from '@/renderer/pi-rpc/response-presentation'
import type { SubagentInspectorFocusRequest, Turn } from '@/types/chat'
import { transientTurnAnimationKey } from './ConversationMessages'

/** Every source segment keeps its place, including commentary before tools.
 * Disclosures belong to the individual thinking/tool renderer, never the reply.
 */
export function ConversationResponse({ response, highlighted, anchorRef, renderPrompt, renderSegment, searchPreview }: {
  response: ResponsePresentation
  highlighted: boolean
  searchPreview?: React.ReactNode
  anchorRef?: (node: HTMLDivElement | null) => void
  sessionKey: string | null
  focusRequest?: SubagentInspectorFocusRequest | null
  renderPrompt(turn: Extract<Turn, { kind: 'user' }>): React.ReactNode
  renderSegment(item: ResponsePresentationSegment, visible: boolean): React.ReactNode
}) {
  const t = useT()
  return <div
    ref={anchorRef}
    data-conversation-outline-entry={response.anchorEntryId}
    data-outline-highlighted={highlighted || undefined}
    data-conversation-response={response.id}
    // The highlight frame sits 12px outside the content, so it never lands on
    // the edge of a full-width card or bubble inside the reply. A shadow
    // spread (tint) and an offset outline (edge) draw it without widening the layout.
    className={cn(
      'min-w-0 rounded-[4px] pb-2 transition-[background-color,box-shadow,outline-color] duration-(--duration-base) [outline:1px_solid_transparent] [outline-offset:12px] motion-reduce:transition-none',
      highlighted && 'bg-primary/[0.05] shadow-[0_0_0_12px_color-mix(in_srgb,var(--color-primary)_5%,transparent)] outline-[color-mix(in_srgb,var(--color-primary)_28%,transparent)]',
    )}
  >
    {searchPreview}
    {response.prompt ? <div className="mb-7 min-w-0">{renderPrompt(response.prompt)}</div> : null}
    <div className="conversation-flow min-w-0">
      {response.segments.map((item) => <div
        key={item.kind === 'turn' && (item.turn.kind === 'agent' || item.turn.kind === 'thinking') ? transientTurnAnimationKey(item.turn.id) : item.id}
        data-response-region={item.region}
        data-response-segment={item.kind === 'turn' ? item.turn.kind : 'tools'}
        className="min-w-0"
      >{renderSegment(item, true)}</div>)}
      {response.isActive && !response.work.hasActiveWork ? <p role="status" className="flex items-center gap-2 py-2 text-caption text-muted-foreground"><TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t('chat.work.waiting')}</p> : null}
    </div>
  </div>
}
