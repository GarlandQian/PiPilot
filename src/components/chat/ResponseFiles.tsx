import * as React from 'react'
import { TbChevronRight, TbDots, TbFile, TbFileDiff, TbFocus2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import type { ConversationChangedFile } from '@/renderer/pi-rpc/conversation-context'

export interface ResponseFileItem extends ConversationChangedFile {
  /** Supplied by the workspace's path validation, never inferred from tool text. */
  openDisabledReason?: string
}

export interface ResponseFilesProps {
  items: readonly ResponseFileItem[]
  onOpen?: (path: string) => void
  onReview?: (path: string) => void
  onLocate?: (toolCallId: string) => void
}

/** Successful file operations are evidence for this reply, not deliverable claims. */
export function ResponseFiles({ items, onOpen, onReview, onLocate }: ResponseFilesProps) {
  const t = useT()
  const pendingLocate = React.useRef<string | null>(null)
  if (!items.length) return null
  return <Collapsible className="min-w-0 pt-3" data-response-files>
    <CollapsibleTrigger className="group flex min-h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-caption text-muted-foreground hover:bg-fill hover:text-foreground focus-visible:focus-ring">
      <TbChevronRight className="size-3 shrink-0 stroke-[2.6] transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" aria-hidden />
      <span className="min-w-0 truncate">{t('responseFiles.title', { count: items.length })}</span>
    </CollapsibleTrigger>
    <CollapsibleContent className="pt-1">
      <p className="px-2 pb-1 text-micro text-muted-foreground">{t('responseFiles.hint')}</p>
      <ul className="min-w-0 space-y-px">
        {items.map((item) => {
          const disabledReason = item.openDisabledReason || (!onOpen ? t('responseFiles.unavailable') : undefined)
          return <li key={item.path} className="flex min-w-0 items-center gap-1 rounded-md hover:bg-fill/50" data-response-file={item.path}>
            <button
              type="button"
              disabled={Boolean(disabledReason)}
              onClick={() => onOpen?.(item.path)}
              title={`${item.path} · ${disabledReason ?? t('responseFiles.open')}`}
              className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill focus-visible:focus-ring disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
            >
              <TbFile className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-caption">{item.path}</span>
              <span className="shrink-0 text-micro text-muted-foreground">{t(`responseFiles.${item.action}`)}</span>
            </button>
            {onReview || onLocate ? <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="mr-1 shrink-0 rounded-md" aria-label={t('responseFiles.actions', { path: item.path })} title={t('responseFiles.actions', { path: item.path })}>
                  <TbDots className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
                const toolCallId = pendingLocate.current
                if (!toolCallId) return
                pendingLocate.current = null
                // Navigate after the menu releases its focus scope. Its
                // normal restoration would otherwise steal focus back.
                event.preventDefault()
                onLocate?.(toolCallId)
              }}>
                {onReview ? <DropdownMenuItem disabled={Boolean(item.openDisabledReason)} onSelect={() => onReview(item.path)}><TbFileDiff className="size-3.5" aria-hidden />{t('responseFiles.review')}</DropdownMenuItem> : null}
                {onLocate ? <DropdownMenuItem onSelect={() => { pendingLocate.current = item.toolCallId }}><TbFocus2 className="size-3.5" aria-hidden />{t('responseFiles.locate')}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu> : null}
          </li>
        })}
      </ul>
    </CollapsibleContent>
  </Collapsible>
}
