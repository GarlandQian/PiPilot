import * as React from 'react'
import { TbChevronRight } from 'react-icons/tb'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { parsePromptSkillEnvelope } from '@/renderer/pi-rpc/prompt-presentation'
import { InlineMarkdown } from './markdown/InlineMarkdown'
import { MarkdownContent } from './markdown/MarkdownContent'

/** The original prompt is retained by its owner for sending and copying. */
export function PromptMarkdown({ text, compact = false }: { text: string; compact?: boolean }) {
  const t = useT()
  const skill = React.useMemo(() => parsePromptSkillEnvelope(text), [text])
  const message = skill?.userMessage ?? text
  return <div className="min-w-0 space-y-2">
    {skill ? <details className="group/skill min-w-0">
      <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md outline-none focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
        <Badge variant="secondary" className="min-w-0 shrink text-micro" data-prompt-skill={skill.name}>
          <span className="truncate">{skill.name}</span>
        </Badge>
        <span className="shrink-0 text-micro text-muted-foreground">{t('prompt.skillDetails')}</span>
        <TbChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform group-open/skill:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="scroll-slim mt-2 max-h-72 min-w-0 overflow-y-auto border-l border-border pl-3" data-prompt-skill-content>
        <MarkdownContent markdown={skill.content} />
      </div>
    </details> : null}
    {message ? <div className={cn('min-w-0', compact && 'max-h-20 overflow-hidden')} data-prompt-message>
      <MarkdownContent markdown={message} />
    </div> : null}
  </div>
}

/** Skill identity remains visible in compact previews without nested controls. */
export function PromptInlineMarkdown({ text }: { text: string }) {
  const skill = React.useMemo(() => parsePromptSkillEnvelope(text), [text])
  if (!skill) return <InlineMarkdown markdown={text} />
  return <span>
    <Badge variant="secondary" className="mr-1.5 max-w-40 align-middle text-micro" data-prompt-skill={skill.name}>
      <span className="truncate">{skill.name}</span>
    </Badge>
    {skill.userMessage ? <InlineMarkdown markdown={skill.userMessage} /> : null}
  </span>
}
