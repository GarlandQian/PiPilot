import * as React from 'react'
import {
  TbChevronDown,
  TbDots,
  TbListDetails,
  TbLoader2,
  TbPhoto,
  TbRoute,
  TbTrash,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  projectPendingRail,
  type ComposerQueueMode,
  type ComposerQueueState,
  type PendingRailItem,
} from '@/renderer/composer/composer-controls'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import type { RunningSubmitPreference } from '@/shared/settings'
import { MarkdownContent } from './markdown/MarkdownContent'
import { PromptInlineMarkdown, PromptMarkdown } from './PromptMarkdown'
import { parsePromptSkillEnvelope, promptDisplaySummary } from '@/renderer/pi-rpc/prompt-presentation'

interface PendingMessageRailProps {
  operationOwnerKey: string
  queue: ComposerQueueState
  runningSubmitPreference: RunningSubmitPreference
  onRunningSubmitPreferenceChange(value: RunningSubmitPreference): void
  onSetQueueMode(kind: 'steering' | 'followUp', mode: ComposerQueueMode): Promise<void>
  onPromoteFollowUp(itemId: string): Promise<void>
  onRemoveQueuedMessage(itemId: string): Promise<void>
}

function QueueModeControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: ComposerQueueMode
  disabled: boolean
  onChange(mode: ComposerQueueMode): void
}) {
  const t = useT()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(mode) => {
            if (mode === 'all' || mode === 'one-at-a-time') onChange(mode)
          }}
          aria-label={label}
        >
          {(['one-at-a-time', 'all'] as const).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode} disabled={disabled}>
              {t(mode === 'all' ? 'composer.queueMode.all' : 'composer.queueMode.one')}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function PendingImages({ item, expanded }: { item: PendingRailItem; expanded: boolean }) {
  const t = useT()
  if (item.images.length === 0) return null
  return (
    <div className={cn('mt-2 flex min-w-0 flex-wrap gap-2', expanded && 'flex-col')} data-queue-image-list>
      {item.images.map((image, index) => (
        <img
          key={`${image.mimeType}:${index}`}
          src={`data:${image.mimeType};base64,${image.data}`}
          alt={t('composer.queueImageAlt', { index: index + 1 })}
          className={cn(
            'shrink-0 rounded-md border border-border bg-background object-contain',
            expanded ? 'max-h-60 max-w-full self-start' : 'size-12',
          )}
          data-queue-image
        />
      ))}
    </div>
  )
}

export function PendingItemContent({ item }: { item: PendingRailItem }) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const contentId = React.useId()
  const message = parsePromptSkillEnvelope(item.text)?.userMessage ?? item.text
  const canExpand = message.length > 240 || message.split('\n').length > 3 || item.images.length > 0
  return (
    <div className="min-w-0 flex-1">
      <span className="text-micro font-medium text-muted-foreground">
        {t(item.kind === 'steering' ? 'composer.steering' : 'composer.followUp')}
      </span>
      <div id={contentId} className={cn('min-w-0', expanded && 'scroll-slim max-h-72 overflow-y-auto')}>
        <div
          className="mt-1 min-w-0 break-words text-caption leading-relaxed text-foreground [overflow-wrap:anywhere]"
          data-pending-message-text
          data-expanded={expanded}
        >
          <PromptMarkdown text={item.text || t('composer.pendingImagesOnly')} compact={!expanded && canExpand} />
        </div>
        <PendingImages item={item} expanded={expanded} />
      </div>
      {canExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mt-1 -ml-2 text-muted-foreground"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <TbChevronDown className={cn('size-3.5', expanded && 'rotate-180')} aria-hidden />
          {t(expanded ? 'composer.pendingMessageCollapse' : 'composer.pendingMessageExpand')}
        </Button>
      ) : null}
    </div>
  )
}

function PendingItemActions({
  item,
  busy,
  onPromote,
  onRemove,
}: {
  item: PendingRailItem
  busy: boolean
  onPromote(itemId: string): void
  onRemove(itemId: string): void
}) {
  const t = useT()
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {item.kind === 'followUp' && item.canPromote ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-7 px-2 text-caption"
          disabled={busy}
          onClick={() => onPromote(item.id)}
        >
          <TbRoute aria-hidden />
          {t('composer.promoteToSteer')}
        </Button>
      ) : null}
      {item.canRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              aria-label={t('composer.removePending')}
              onClick={() => onRemove(item.id)}
            >
              <TbTrash aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('composer.removePending')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function PendingMessageRail({
  operationOwnerKey,
  queue,
  runningSubmitPreference,
  onRunningSubmitPreferenceChange,
  onSetQueueMode,
  onPromoteFollowUp,
  onRemoveQueuedMessage,
}: PendingMessageRailProps) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const feedback = useConversationOperationFeedback(operationOwnerKey)
  const busyAction = feedback.pending?.action ?? null
  const presentation = React.useMemo(() => projectPendingRail(queue), [queue])

  React.useEffect(() => {
    if (!presentation.visible) {
      setExpanded(false)
    }
  }, [presentation.visible])

  if (!presentation.visible) return null

  const run = (key: string, operation: () => Promise<void>) => {
    void feedback.run(key, operation, t('composer.queueActionFailed'))
  }

  const promote = (itemId: string) => {
    run(`promote:${itemId}`, () => onPromoteFollowUp(itemId))
  }
  const remove = (itemId: string) => {
    run(`remove:${itemId}`, () => onRemoveQueuedMessage(itemId))
  }
  const setMode = (kind: 'steering' | 'followUp', mode: ComposerQueueMode) => {
    run(`mode:${kind}`, () => onSetQueueMode(kind, mode))
  }

  const next = presentation.items[0]
  const nextSummary = presentation.detailsKnown
    ? (presentation.nextText?.trim() || t('composer.pendingImagesOnly'))
    : t('composer.queueCountOnly', { count: presentation.count })

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-pending-message-rail
      aria-busy={Boolean(busyAction)}
      className="min-w-0 overflow-hidden rounded-t-(--radius-composer) border border-b-0 border-border/70 bg-muted/60"
    >
      <div className="flex min-h-11 min-w-0 items-center gap-1 px-3">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/40 focus-visible:focus-ring motion-reduce:transition-none"
            aria-label={expanded ? t('composer.pendingCollapse') : t('composer.pendingExpand')}
          >
            {busyAction
              ? <TbLoader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
              : <TbListDetails className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="shrink-0 text-caption font-medium tabular-nums text-foreground">
              {t('composer.pendingCount', { count: presentation.count })}
            </span>
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={promptDisplaySummary(nextSummary)}>
              <PromptInlineMarkdown text={nextSummary} />
            </span>
            {presentation.nextImageCount > 0 ? (
              <span className="flex shrink-0 items-center gap-1 text-micro tabular-nums text-muted-foreground">
                <TbPhoto aria-hidden />
                {presentation.nextImageCount}
              </span>
            ) : null}
            <TbChevronDown
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>

        {!expanded && next ? (
          <PendingItemActions
            item={next}
            busy={Boolean(busyAction)}
            onPromote={promote}
            onRemove={remove}
          />
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('composer.pendingMore')}
            >
              <TbDots aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" collisionPadding={12}>
            <DropdownMenuItem onSelect={() => setExpanded((current) => !current)}>
              <TbChevronDown className={cn(expanded && 'rotate-180')} aria-hidden />
              {expanded ? t('composer.pendingCollapse') : t('composer.pendingExpand')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <QueueModeControl
              label={t('composer.steering')}
              value={queue.steeringMode}
              disabled={Boolean(busyAction)}
              onChange={(mode) => setMode('steering', mode)}
            />
            <QueueModeControl
              label={t('composer.followUp')}
              value={queue.followUpMode}
              disabled={Boolean(busyAction)}
              onChange={(mode) => setMode('followUp', mode)}
            />
            <DropdownMenuItem
              onSelect={() => onRunningSubmitPreferenceChange(
                runningSubmitPreference === 'queue' ? 'steer' : 'queue',
              )}
            >
              <TbRoute aria-hidden />
              {runningSubmitPreference === 'queue'
                ? t('composer.turnOffQueueing')
                : t('composer.turnOnQueueing')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent>
        <div className="border-t border-border px-2 pb-2 pt-1.5">
          {presentation.detailsKnown ? (
            <ol className="scroll-slim max-h-[min(320px,40vh)] divide-y divide-border overflow-y-auto">
              {presentation.items.map((item) => (
                <li key={item.id} className="flex min-w-0 items-start gap-3 px-1 py-2.5">
                  <PendingItemContent item={item} />
                  <PendingItemActions
                    item={item}
                    busy={Boolean(busyAction)}
                    onPromote={promote}
                    onRemove={remove}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-1 text-caption text-muted-foreground">
              {t('composer.queueCountOnly', { count: presentation.count })}
            </p>
          )}
        </div>
      </CollapsibleContent>

      {feedback.error ? (
        <div role="alert" className="border-t border-border px-3 py-1.5 text-caption text-destructive">
          <MarkdownContent markdown={feedback.error} />
        </div>
      ) : null}
    </Collapsible>
  )
}
