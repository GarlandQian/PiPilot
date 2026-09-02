import * as React from 'react'
import {
  TbArrowUp,
  TbBrain,
  TbChevronDown,
  TbListDetails,
  TbPlayerStop,
  TbPlus,
  TbRoute,
  TbX,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  LocalPiCommandArgumentCompletion,
  LocalPiImageContent,
  LocalPiSlashCommand,
  LocalPiThinkingLevel,
} from '@/shared/local-pi'
import type { ComposerSendShortcut } from '@/shared/settings'
import type { WorkspacePathSearchResult } from '@/shared/workspace-content'
import {
  attachmentsToPiImagesIfCurrent,
  composerImageKey,
  isComposerSendShortcut,
  validateComposerImageBatch,
  type ComposerImageAttachment,
  type ComposerImageValidationError,
} from '@/renderer/composer/composer-submission'
import {
  applyComposerSlashArgumentCompletion,
  composerCommandArgumentRequestMatches,
  composerSlashArgumentQuery,
  createComposerCommandArgumentRequest,
  projectComposerCommandArgumentCandidates,
  type ComposerCommandArgumentCandidate,
  type ComposerCommandArgumentRequestIdentity,
  type ComposerSlashArgumentQuery,
} from '@/renderer/composer/extension-command-completions'
import {
  composerDocumentHasSkill,
  composerLeadingSlashConflict,
  composerMentionRequestMatches,
  composerMentionSuggestionMatches,
  filterComposerMentionCandidates,
  plainTextToComposerDocument,
  projectComposerMentionCandidates,
  serializeComposerDocument,
  shouldClearCapturedComposer,
  type ComposerDocumentSnapshot,
  type ComposerMentionCandidate,
  type ComposerMentionCandidateGroups,
  type ComposerMentionRequestIdentity,
  type ComposerPathMentionCandidate,
} from '@/renderer/composer/composer-mentions'
import {
  composerSlashQuery,
  filterComposerCandidates,
  projectComposerCommands,
  type ComposerExecutableCandidate,
} from '@/renderer/composer/skill-commands'
import {
  composerPickerOptionId,
  createComposerPickerRows,
  isComposerPickerSelectionKey,
  transitionComposerPickerActiveId,
  type ComposerPickerRow,
} from '@/renderer/composer/composer-picker'
import type { PiQueuedMessage } from '@/renderer/pi-rpc/queue-payloads'
import { ModelPicker, type PiModelOption } from './ModelPicker'
import {
  ComposerEditor,
  type ComposerEditorChange,
  type ComposerEditorHandle,
  type ComposerEditorSuggestion,
} from './ComposerEditor'
import {
  COMPOSER_MENTION_LISTBOX_ID,
} from './ComposerMentionPicker'
import { COMPOSER_SLASH_LISTBOX_ID, SkillPicker } from './SkillPicker'

type SubmitAction = 'prompt' | 'follow_up' | 'steer'
type QueueMode = 'all' | 'one-at-a-time'

export interface ComposerSubmitMode {
  action: Extract<SubmitAction, 'prompt' | 'follow_up'>
  allowsSteer: boolean
  kind: 'send' | 'queue' | 'run-now'
}

export function deriveComposerSubmitMode(
  isStreaming: boolean,
  hasExtensionCommand: boolean,
): ComposerSubmitMode {
  if (!isStreaming) {
    return { action: 'prompt', allowsSteer: false, kind: 'send' }
  }
  if (hasExtensionCommand) {
    return { action: 'prompt', allowsSteer: false, kind: 'run-now' }
  }
  return { action: 'follow_up', allowsSteer: true, kind: 'queue' }
}

export type ComposerCommandCatalogState =
  | { state: 'unavailable' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready' }

export interface ComposerQueueState {
  pendingCount: number
  detailsKnown: boolean
  steering: readonly string[]
  followUp: readonly string[]
  steeringItems: readonly PiQueuedMessage[]
  followUpItems: readonly PiQueuedMessage[]
  steeringMode: QueueMode
  followUpMode: QueueMode
}

export interface ComposerMentionInsertionRequest {
  candidate: ComposerPathMentionCandidate
  scopeKey: string
  sequence: number
}

export interface ComposerProps {
  connected: boolean
  loadingModels: boolean
  modelError?: string | null
  selectedModel: PiModelOption | null
  models: readonly PiModelOption[]
  isStreaming: boolean
  commands: readonly LocalPiSlashCommand[]
  commandCatalogState: ComposerCommandCatalogState
  queue: ComposerQueueState
  selectedThinkingLevel: LocalPiThinkingLevel | null
  thinkingLevels: readonly LocalPiThinkingLevel[]
  draftReplacement?: { revision: number; text: string } | null
  mentionInsertionRequest?: ComposerMentionInsertionRequest | null
  scopeKey: string
  sendShortcut: ComposerSendShortcut
  supportsImages: boolean
  onModelChange(providerId: string, modelId: string): void | Promise<void>
  onSubmit(
    text: string,
    action: SubmitAction,
    images?: readonly LocalPiImageContent[],
  ): Promise<void>
  onStop(): void | Promise<void>
  onThinkingChange(level: LocalPiThinkingLevel): void | Promise<void>
  onSetQueueMode(kind: 'steering' | 'followUp', mode: QueueMode): Promise<void>
  onPromoteFollowUp(itemId: string): Promise<void>
  onCompleteCommandArguments?(
    commandName: string,
    argumentPrefix: string,
  ): Promise<readonly LocalPiCommandArgumentCompletion[]>
  onSearchContext?(query: string): Promise<WorkspacePathSearchResult>
}

type BoundComposerCommandArgumentState =
  | { state: 'absent' }
  | { state: 'loading'; request: ComposerCommandArgumentRequestIdentity }
  | {
    state: 'ready'
    request: ComposerCommandArgumentRequestIdentity
    items: readonly LocalPiCommandArgumentCompletion[]
  }
  | { state: 'error'; request: ComposerCommandArgumentRequestIdentity }

type BoundComposerMentionFileState =
  | { state: 'absent' }
  | { state: 'loading' }
  | { state: 'error'; request: ComposerMentionRequestIdentity }
  | {
    state: 'ready'
    request: ComposerMentionRequestIdentity
    result: WorkspacePathSearchResult
  }

type ComposerMentionFileState =
  | { state: 'absent' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; result: WorkspacePathSearchResult }

type ComposerT = ReturnType<typeof useT>

function candidateMetadata(candidate: ComposerExecutableCandidate, t: ComposerT) {
  return `${t(`composer.commandScope.${candidate.scope}`)} · ${t(`composer.commandOrigin.${candidate.origin}`)}`
}

function commandCatalogStatus(
  state: ComposerCommandCatalogState,
  fallback: string,
): Extract<ComposerPickerRow, { kind: 'status' }> {
  return {
    kind: 'status',
    id: 'status:command-catalog',
    label: state.state === 'error' ? state.message : fallback,
    tone: state.state === 'error' ? 'danger' : 'muted',
  }
}

function slashPickerRows({
  catalogState,
  commands,
  commandConflict,
  skills,
  t,
}: {
  catalogState: ComposerCommandCatalogState
  commands: readonly ComposerExecutableCandidate[]
  commandConflict: string | null
  skills: readonly ComposerExecutableCandidate[]
  t: ComposerT
}): ComposerPickerRow[] {
  if (catalogState.state !== 'ready') {
    const message = catalogState.state === 'unavailable'
      ? t('composer.commandUnavailable')
      : catalogState.state === 'loading'
        ? t('composer.commandLoading')
        : catalogState.message
    return createComposerPickerRows([{
      id: 'commands',
      label: t('composer.commandMenuTitle'),
      rows: [commandCatalogStatus(catalogState, message)],
    }])
  }

  if (commands.length === 0 && skills.length === 0) {
    return createComposerPickerRows([{
      id: 'commands',
      label: t('composer.commandMenuTitle'),
      rows: [commandCatalogStatus(catalogState, t('composer.commandNoResults'))],
    }])
  }

  return createComposerPickerRows([
    {
      id: 'commands',
      label: t('composer.commandMenuTitle'),
      rows: commands.map((candidate) => ({
        kind: 'option' as const,
        id: candidate.id,
        group: 'commands' as const,
        icon: 'command' as const,
        label: `/${candidate.name}`,
        description: (commandConflict ?? candidate.description) || undefined,
        descriptionTone: commandConflict ? 'danger' as const : 'muted' as const,
        meta: candidateMetadata(candidate, t),
        disabled: Boolean(commandConflict),
      })),
    },
    {
      id: 'skills',
      label: t('composer.mentions.skills'),
      rows: skills.map((candidate) => ({
        kind: 'option' as const,
        id: candidate.id,
        group: 'skills' as const,
        icon: 'skill' as const,
        label: `/${candidate.name}`,
        description: candidate.description || undefined,
        descriptionTone: 'muted' as const,
        meta: candidateMetadata(candidate, t),
        disabled: false,
      })),
    },
  ])
}

function argumentPickerRows({
  candidates,
  state,
  t,
}: {
  candidates: readonly ComposerCommandArgumentCandidate[]
  state: BoundComposerCommandArgumentState
  t: ComposerT
}): ComposerPickerRow[] {
  let rows: Exclude<ComposerPickerRow, { kind: 'heading' }>[]
  if (state.state === 'loading') {
    rows = [{
      kind: 'status',
      id: 'status:command-arguments-loading',
      label: t('composer.commandArgumentsLoading'),
      tone: 'muted',
    }]
  } else if (state.state === 'error') {
    rows = [{
      kind: 'status',
      id: 'status:command-arguments-error',
      label: t('composer.commandArgumentsFailed'),
      tone: 'danger',
    }]
  } else if (state.state === 'ready' && candidates.length > 0) {
    rows = candidates.map((candidate) => ({
      kind: 'option' as const,
      id: candidate.id,
      group: 'commands' as const,
      icon: 'command' as const,
      label: candidate.label,
      description: candidate.description,
      descriptionTone: 'muted' as const,
      meta: candidate.label === candidate.value ? undefined : candidate.value,
      title: candidate.description,
      disabled: false,
    }))
  } else {
    rows = [{
      kind: 'status',
      id: 'status:command-arguments-empty',
      label: t('composer.commandArgumentsEmpty'),
      tone: 'muted',
    }]
  }

  return createComposerPickerRows([{
    id: 'command-arguments',
    label: t('composer.commandArgumentsTitle'),
    rows,
  }])
}

function mentionPickerRows({
  catalogState,
  fileState,
  groups,
  query,
  skillConflict,
  t,
}: {
  catalogState: ComposerCommandCatalogState
  fileState: ComposerMentionFileState
  groups: ComposerMentionCandidateGroups
  query: string
  skillConflict: string | null
  t: ComposerT
}): ComposerPickerRow[] {
  const fileRows: Exclude<ComposerPickerRow, { kind: 'heading' }>[] = []
  if (fileState.state === 'loading') {
    fileRows.push({
      kind: 'status',
      id: 'status:files-loading',
      label: t('composer.contextLoading'),
      tone: 'muted',
    })
  } else if (fileState.state === 'error') {
    fileRows.push({
      kind: 'status',
      id: 'status:files-error',
      label: t('composer.contextFailed'),
      tone: 'danger',
    })
  } else if (fileState.state === 'ready') {
    if (groups.files.length === 0) {
      fileRows.push({
        kind: 'status',
        id: 'status:files-empty',
        label: t('composer.contextEmpty'),
        tone: 'muted',
      })
    } else {
      fileRows.push(...groups.files.map((candidate) => ({
        kind: 'option' as const,
        id: candidate.id,
        group: 'files' as const,
        icon: candidate.kind === 'directory' ? 'directory' as const : 'file' as const,
        label: `${candidate.path}${candidate.kind === 'directory' ? '/' : ''}`,
        title: `${candidate.path}${candidate.kind === 'directory' ? '/' : ''}`,
        disabled: false,
      })))
      if (fileState.result.truncated) {
        fileRows.push({
          kind: 'status',
          id: 'status:files-truncated',
          label: t('composer.contextTruncated'),
          tone: 'muted',
        })
      }
    }
  }

  const skillRows: Exclude<ComposerPickerRow, { kind: 'heading' }>[] = []
  if (catalogState.state === 'unavailable') {
    skillRows.push({
      kind: 'status',
      id: 'status:skills-unavailable',
      label: t('composer.commandUnavailable'),
      tone: 'muted',
    })
  } else if (catalogState.state === 'loading') {
    skillRows.push({
      kind: 'status',
      id: 'status:skills-loading',
      label: t('composer.commandLoading'),
      tone: 'muted',
    })
  } else if (catalogState.state === 'error') {
    skillRows.push({
      kind: 'status',
      id: 'status:skills-error',
      label: catalogState.message,
      tone: 'danger',
    })
  } else if (groups.skills.length === 0) {
    skillRows.push({
      kind: 'status',
      id: 'status:skills-empty',
      label: query ? t('composer.skillsNoResults') : t('composer.skillsEmpty'),
      tone: 'muted',
    })
  } else {
    skillRows.push(...groups.skills.flatMap((candidate) => candidate.kind !== 'skill'
      ? []
      : [{
          kind: 'option' as const,
          id: candidate.id,
          group: 'skills' as const,
          icon: 'skill' as const,
          label: candidate.label,
          description: (skillConflict ?? candidate.description) || undefined,
          descriptionTone: skillConflict ? 'danger' as const : 'muted' as const,
          meta: `${t(`composer.commandScope.${candidate.scope}`)} · ${t(`composer.commandOrigin.${candidate.origin}`)}`,
          disabled: Boolean(skillConflict),
        }]))
  }

  return createComposerPickerRows([
    ...(fileState.state === 'absent' ? [] : [{
      id: 'files',
      label: t('composer.mentions.files'),
      rows: fileRows,
    }]),
    {
      id: 'skills',
      label: t('composer.mentions.skills'),
      rows: skillRows,
    },
  ])
}

function commandName(text: string) {
  const token = text.trimStart().split(/\s/u, 1)[0]
  return token?.startsWith('/') ? token.slice(1) : ''
}

function QueueList({
  label,
  items,
  busy,
  canPromote,
  onPromote,
}: {
  label: string
  items: readonly PiQueuedMessage[]
  busy: boolean
  canPromote: boolean
  onPromote?: (itemId: string) => void
}) {
  const t = useT()
  if (items.length === 0) return null
  return (
    <section>
      <h3 className="px-1 pb-1 text-micro font-medium text-muted-foreground">
        {label}
      </h3>
      <ul className="divide-y divide-border/70">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex min-w-0 items-start gap-2 px-1 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p title={item.text} className="truncate text-caption text-foreground">
                {item.text}
              </p>
              {item.images.length > 0 ? (
                <div className="mt-1 flex gap-1" data-queue-image-list>
                  {item.images.map((image, index) => (
                    <img
                      key={`${image.mimeType}:${index}`}
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={t('composer.queueImageAlt', { index: index + 1 })}
                      className="h-8 w-8 rounded-sm border border-border object-cover"
                      data-queue-image
                    />
                  ))}
                </div>
              ) : null}
            </div>
            {onPromote ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    disabled={busy || !canPromote}
                    aria-label={t('composer.promoteToSteer')}
                    onClick={() => onPromote(item.id)}
                  >
                    <TbRoute aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {canPromote
                    ? t('composer.promoteToSteer')
                    : t('composer.promoteUnavailable')}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function QueueModeControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: QueueMode
  onChange(mode: QueueMode): void
}) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-micro text-muted-foreground">{label}</span>
      <div className="flex rounded-md border border-border p-0.5" role="group" aria-label={label}>
        {(['one-at-a-time', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            className="h-6 rounded-sm px-1.5 text-micro text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:focus-ring aria-pressed:bg-accent aria-pressed:text-foreground motion-reduce:transition-none"
            onClick={() => onChange(mode)}
          >
            {t(mode === 'all' ? 'composer.queueMode.all' : 'composer.queueMode.one')}
          </button>
        ))}
      </div>
    </div>
  )
}

function QueuePopover({
  queue,
  onSetQueueMode,
  onPromoteFollowUp,
}: {
  queue: ComposerQueueState
  onSetQueueMode: ComposerProps['onSetQueueMode']
  onPromoteFollowUp: ComposerProps['onPromoteFollowUp']
}) {
  const t = useT()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  if (queue.pendingCount === 0) return null

  const setMode = (kind: 'steering' | 'followUp', mode: QueueMode) => {
    if (busy) return
    setBusy(true)
    setError(null)
    void onSetQueueMode(kind, mode)
      .catch(() => setError(t('composer.queueActionFailed')))
      .finally(() => setBusy(false))
  }

  const promote = (itemId: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    void onPromoteFollowUp(itemId)
      .catch(() => setError(t('composer.queueActionFailed')))
      .finally(() => setBusy(false))
  }

  const canPromote = queue.detailsKnown &&
    [...queue.steeringItems, ...queue.followUpItems]
      .every((item) => item.locallyOwned)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative tabular-nums"
          aria-label={t('composer.queueOpen', { count: queue.pendingCount })}
        >
          <TbListDetails aria-hidden />
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-muted px-1 text-micro leading-4 text-foreground"
          >
            {queue.pendingCount > 99 ? '99+' : queue.pendingCount}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="w-[min(340px,calc(100vw-24px))] p-2"
      >
        <div className="scroll-slim flex max-h-48 flex-col gap-2 overflow-y-auto">
          {queue.detailsKnown ? (
            <>
              <QueueList
                label={t('composer.steering')}
                items={queue.steeringItems}
                busy={busy}
                canPromote={canPromote}
              />
              <QueueList
                label={t('composer.followUp')}
                items={queue.followUpItems}
                busy={busy}
                canPromote={canPromote}
                onPromote={promote}
              />
            </>
          ) : (
            <p className="px-1 py-2 text-caption text-muted-foreground">
              {t('composer.queueCountOnly', { count: queue.pendingCount })}
            </p>
          )}
        </div>
        {error ? (
          <p role="alert" className="mt-2 border-t border-border px-1 pt-2 text-micro text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2 aria-disabled:opacity-50" aria-disabled={busy}>
          <QueueModeControl
            label={t('composer.steering')}
            value={queue.steeringMode}
            onChange={(mode) => setMode('steering', mode)}
          />
          <QueueModeControl
            label={t('composer.followUp')}
            value={queue.followUpMode}
            onChange={(mode) => setMode('followUp', mode)}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ThinkingPicker({
  connected,
  levels,
  selected,
  onSelect,
}: {
  connected: boolean
  levels: readonly LocalPiThinkingLevel[]
  selected: LocalPiThinkingLevel | null
  onSelect(level: LocalPiThinkingLevel): void | Promise<void>
}) {
  const t = useT()
  const [selecting, setSelecting] = React.useState(false)

  if (!selected || levels.length === 0) return null

  return (
    <Select
      value={selected}
      disabled={!connected || selecting}
      onValueChange={(value) => {
        if (selecting || value === selected) return
        setSelecting(true)
        void Promise.resolve(onSelect(value as LocalPiThinkingLevel))
          .catch(() => undefined)
          .finally(() => setSelecting(false))
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t('settings.models.thinkingTitle')}
        className="h-8 min-w-0 max-w-28 gap-1 border-0 bg-transparent px-2 py-0 text-caption shadow-none hover:bg-accent focus-visible:focus-ring dark:bg-transparent dark:hover:bg-accent/50"
      >
        <TbBrain className="size-3.5" aria-hidden />
        <SelectValue>
          {t(`settings.models.thinking.${selected}`)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent side="top" align="start" position="popper" sideOffset={8}>
        {levels.map((level) => (
          <SelectItem key={level} value={level}>
            {t(`settings.models.thinking.${level}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function imageValidationMessage(
  error: ComposerImageValidationError,
  t: ReturnType<typeof useT>,
) {
  return t(`composer.imageError.${error}`)
}

function attachmentSize(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`
}

function initialEditorChange(): ComposerEditorChange {
  return {
    revision: 0,
    document: plainTextToComposerDocument(''),
    hasContent: false,
    plainText: '',
    plainTextBeforeCursor: '',
  }
}

export function Composer({
  connected,
  loadingModels,
  modelError,
  selectedModel,
  models,
  isStreaming,
  commands,
  commandCatalogState,
  queue,
  selectedThinkingLevel,
  thinkingLevels,
  draftReplacement,
  mentionInsertionRequest,
  scopeKey,
  sendShortcut,
  supportsImages,
  onModelChange,
  onSubmit,
  onStop,
  onThinkingChange,
  onSetQueueMode,
  onPromoteFollowUp,
  onCompleteCommandArguments,
  onSearchContext,
}: ComposerProps) {
  const t = useT()
  const hasContextSource = onSearchContext !== undefined
  const [editorChange, setEditorChange] = React.useState(initialEditorChange)
  const [attachments, setAttachments] = React.useState<ComposerImageAttachment[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const [commandPickerOpen, setCommandPickerOpen] = React.useState(false)
  const [slashActiveId, setSlashActiveId] = React.useState<string | null>(null)
  const [commandArgumentState, setCommandArgumentState] =
    React.useState<BoundComposerCommandArgumentState>({ state: 'absent' })
  const [mentionSuggestion, setMentionSuggestion] = React.useState<ComposerEditorSuggestion | null>(null)
  const [mentionFileState, setMentionFileState] = React.useState<BoundComposerMentionFileState>(
    hasContextSource ? { state: 'loading' } : { state: 'absent' },
  )
  const [mentionActiveId, setMentionActiveId] = React.useState<string | null>(null)
  const appliedDraftRevision = React.useRef(0)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const editorRef = React.useRef<ComposerEditorHandle>(null)
  const dismissedSlashText = React.useRef<string | null>(null)
  const attachmentSnapshot = React.useRef<ComposerImageAttachment[]>([])
  const mentionRequestSequence = React.useRef(0)
  const consumedMentionInsertionSequence = React.useRef(0)
  const commandArgumentRequestSequence = React.useRef(0)
  const mentionSelectionTouched = React.useRef(false)
  const mentionSuggestionRef = React.useRef<ComposerEditorSuggestion | null>(null)
  const scopeKeyRef = React.useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  mentionSuggestionRef.current = mentionSuggestion

  React.useEffect(() => {
    attachmentSnapshot.current = attachments
  }, [attachments])

  React.useEffect(() => {
    // Attachments are user-owned draft content and remain available when the
    // selected Session or Settings surface changes. Scope-bound trusted
    // mentions and async candidate results are reset below.
    editorRef.current?.removeMentions()
    setSubmitError(null)
    setSubmitting(false)
    setCommandPickerOpen(false)
    setSlashActiveId(null)
    setCommandArgumentState({ state: 'absent' })
    setMentionSuggestion(null)
    setMentionFileState(hasContextSource ? { state: 'loading' } : { state: 'absent' })
    setMentionActiveId(null)
    mentionSelectionTouched.current = false
    mentionRequestSequence.current += 1
    commandArgumentRequestSequence.current += 1
    dismissedSlashText.current = null
  }, [hasContextSource, scopeKey])

  React.useEffect(() => {
    if (commandCatalogState.state === 'ready') return
    setCommandPickerOpen(false)
    setSlashActiveId(null)
    setCommandArgumentState({ state: 'absent' })
    commandArgumentRequestSequence.current += 1
    dismissedSlashText.current = null
  }, [commandCatalogState.state])

  React.useEffect(() => () => {
    for (const attachment of attachmentSnapshot.current) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [])

  React.useEffect(() => {
    if (!draftReplacement || draftReplacement.revision <= appliedDraftRevision.current) return
    appliedDraftRevision.current = draftReplacement.revision
    editorRef.current?.replaceWithPlainText(draftReplacement.text)
    const query = composerSlashQuery(draftReplacement.text)
    setCommandPickerOpen(query !== null)
    setSlashActiveId(null)
    dismissedSlashText.current = null
  }, [draftReplacement])

  const commandProjection = React.useMemo(
    () => projectComposerCommands(commandCatalogState.state === 'ready' ? commands : []),
    [commandCatalogState.state, commands],
  )
  const slashQuery = composerSlashQuery(editorChange.plainText)
  const parsedCommandArgumentQuery = React.useMemo(
    () => composerSlashArgumentQuery(
      editorChange.plainTextBeforeCursor,
      editorChange.revision,
    ),
    [
      editorChange.plainTextBeforeCursor,
      editorChange.revision,
    ],
  )
  const commandArgumentQuery = React.useMemo<ComposerSlashArgumentQuery | null>(() => {
    if (
      !parsedCommandArgumentQuery ||
      commandCatalogState.state !== 'ready' ||
      !onCompleteCommandArguments
    ) return null
    const command = commandProjection.topLevel.find((candidate) =>
      candidate.kind === 'command' &&
      candidate.name === parsedCommandArgumentQuery.commandName)
    return command?.hasArgumentCompletions === true
      ? parsedCommandArgumentQuery
      : null
  }, [
    commandCatalogState.state,
    commandProjection.topLevel,
    onCompleteCommandArguments,
    parsedCommandArgumentQuery,
  ])
  const commandArgumentQueryRef = React.useRef<ComposerSlashArgumentQuery | null>(null)
  commandArgumentQueryRef.current = commandArgumentQuery
  const topLevelCandidates = React.useMemo(
    () => filterComposerCandidates(commandProjection.topLevel, slashQuery ?? ''),
    [commandProjection.topLevel, slashQuery],
  )
  const skillCandidates = React.useMemo(
    () => filterComposerCandidates(commandProjection.skills, slashQuery ?? ''),
    [commandProjection.skills, slashQuery],
  )

  const officialExecutableNames = React.useMemo(
    () => commandProjection.topLevel.flatMap((candidate) =>
      candidate.kind === 'command' ? [candidate.name] : []),
    [commandProjection.topLevel],
  )
  const leadingSlashConflict = React.useMemo(
    () => composerLeadingSlashConflict(editorChange.document, officialExecutableNames),
    [editorChange.document, officialExecutableNames],
  )
  const documentHasSkill = React.useMemo(
    () => composerDocumentHasSkill(editorChange.document),
    [editorChange.document],
  )
  const submissionConflict = documentHasSkill ? leadingSlashConflict : null
  const conflictMessage = leadingSlashConflict
    ? t('composer.mentions.skillConflict')
    : null

  const currentMentionFileState = React.useMemo<ComposerMentionFileState>(() => {
    if (!hasContextSource) return { state: 'absent' }
    if (
      mentionSuggestion &&
      (mentionFileState.state === 'ready' || mentionFileState.state === 'error') &&
      composerMentionRequestMatches(scopeKey, mentionSuggestion, mentionFileState.request)
    ) {
      return mentionFileState.state === 'ready'
        ? { state: 'ready', result: mentionFileState.result }
        : { state: 'error' }
    }
    return { state: 'loading' }
  }, [hasContextSource, mentionFileState, mentionSuggestion, scopeKey])

  const mentionProjection = React.useMemo(
    () => projectComposerMentionCandidates(
      currentMentionFileState.state === 'ready'
        ? currentMentionFileState.result.entries
        : [],
      commandProjection.skills,
    ),
    [commandProjection.skills, currentMentionFileState],
  )
  const mentionGroups = React.useMemo(
    () => filterComposerMentionCandidates(
      mentionProjection,
      mentionSuggestion?.query ?? '',
    ),
    [mentionProjection, mentionSuggestion?.query],
  )
  const currentCommandArgumentState = React.useMemo<BoundComposerCommandArgumentState>(() => {
    if (!commandArgumentQuery) return { state: 'absent' }
    if (
      commandArgumentState.state !== 'absent' &&
      composerCommandArgumentRequestMatches(
        scopeKey,
        commandArgumentQuery,
        commandArgumentState.request,
      )
    ) return commandArgumentState
    return {
      state: 'loading',
      request: createComposerCommandArgumentRequest(scopeKey, commandArgumentQuery),
    }
  }, [commandArgumentQuery, commandArgumentState, scopeKey])
  const commandArgumentCandidates = React.useMemo(
    () => projectComposerCommandArgumentCandidates(
      currentCommandArgumentState.state === 'ready'
        ? currentCommandArgumentState.items
        : [],
    ),
    [currentCommandArgumentState],
  )
  const commandRows = React.useMemo(() => slashPickerRows({
    catalogState: commandCatalogState,
    commands: topLevelCandidates,
    commandConflict: documentHasSkill ? t('composer.mentions.skillConflict') : null,
    skills: skillCandidates,
    t,
  }), [commandCatalogState, documentHasSkill, skillCandidates, t, topLevelCandidates])
  const slashRows = React.useMemo(
    () => commandArgumentQuery
      ? argumentPickerRows({
        candidates: commandArgumentCandidates,
        state: currentCommandArgumentState,
        t,
      })
      : commandRows,
    [
      commandArgumentCandidates,
      commandArgumentQuery,
      commandRows,
      currentCommandArgumentState,
      t,
    ],
  )
  const mentionRows = React.useMemo(() => mentionPickerRows({
    catalogState: commandCatalogState,
    fileState: currentMentionFileState,
    groups: mentionGroups,
    query: mentionSuggestion?.query ?? '',
    skillConflict: conflictMessage,
    t,
  }), [
    commandCatalogState,
    conflictMessage,
    currentMentionFileState,
    mentionGroups,
    mentionSuggestion?.query,
    t,
  ])
  const activeSlashId = commandPickerOpen
    ? transitionComposerPickerActiveId(slashRows, slashActiveId, 'reconcile')
    : null
  const activeMentionId = mentionSuggestion
    ? transitionComposerPickerActiveId(mentionRows, mentionActiveId, 'reconcile')
    : null

  React.useEffect(() => {
    if (!commandPickerOpen) return
    setSlashActiveId((current) =>
      transitionComposerPickerActiveId(slashRows, current, 'reconcile'))
  }, [commandPickerOpen, slashRows])

  React.useEffect(() => {
    if (!mentionSuggestion) return
    setMentionActiveId((current) =>
      transitionComposerPickerActiveId(
        mentionRows,
        mentionSelectionTouched.current ? current : null,
        'reconcile',
      ))
  }, [mentionRows, mentionSuggestion])

  const slashCandidateById = React.useMemo(
    () => new Map(
      [...topLevelCandidates, ...skillCandidates].map((candidate) => [candidate.id, candidate]),
    ),
    [skillCandidates, topLevelCandidates],
  )
  const commandArgumentCandidateById = React.useMemo(
    () => new Map(commandArgumentCandidates.map((candidate) => [candidate.id, candidate])),
    [commandArgumentCandidates],
  )
  const mentionCandidateById = React.useMemo(
    () => new Map(
      [...mentionGroups.files, ...mentionGroups.skills].map((candidate) => [candidate.id, candidate]),
    ),
    [mentionGroups.files, mentionGroups.skills],
  )

  React.useEffect(() => {
    const query = commandArgumentQuery
    if (!query || !onCompleteCommandArguments) {
      commandArgumentRequestSequence.current += 1
      setCommandArgumentState({ state: 'absent' })
      return
    }

    const requestSequence = ++commandArgumentRequestSequence.current
    const request = createComposerCommandArgumentRequest(scopeKey, query)
    setCommandArgumentState({ state: 'loading', request })
    setSlashActiveId(null)
    if (dismissedSlashText.current !== editorChange.plainText) {
      setCommandPickerOpen(true)
    }
    const timer = window.setTimeout(() => {
      void onCompleteCommandArguments(query.commandName, query.argumentPrefix)
        .then((items) => {
          if (
            requestSequence === commandArgumentRequestSequence.current &&
            composerCommandArgumentRequestMatches(
              scopeKeyRef.current,
              commandArgumentQueryRef.current,
              request,
            )
          ) {
            setCommandArgumentState({ state: 'ready', request, items })
          }
        })
        .catch(() => {
          if (
            requestSequence === commandArgumentRequestSequence.current &&
            composerCommandArgumentRequestMatches(
              scopeKeyRef.current,
              commandArgumentQueryRef.current,
              request,
            )
          ) {
            setCommandArgumentState({ state: 'error', request })
          }
        })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [
    commandArgumentQuery,
    editorChange.plainText,
    onCompleteCommandArguments,
    scopeKey,
  ])

  React.useEffect(() => {
    const suggestion = mentionSuggestion
    if (!suggestion) {
      mentionRequestSequence.current += 1
      setMentionFileState(hasContextSource ? { state: 'loading' } : { state: 'absent' })
      return
    }
    if (!onSearchContext) {
      mentionRequestSequence.current += 1
      setMentionFileState({ state: 'absent' })
      return
    }

    const requestSequence = ++mentionRequestSequence.current
    const requestScopeKey = scopeKey
    const request: ComposerMentionRequestIdentity = {
      documentRevision: suggestion.documentRevision,
      from: suggestion.from,
      query: suggestion.query,
      scopeKey: requestScopeKey,
      to: suggestion.to,
    }
    setMentionFileState({ state: 'loading' })
    const timer = window.setTimeout(() => {
      void onSearchContext(suggestion.query)
        .then((result) => {
          if (
            requestSequence === mentionRequestSequence.current &&
            scopeKeyRef.current === requestScopeKey &&
            composerMentionSuggestionMatches(mentionSuggestionRef.current, suggestion)
          ) {
            setMentionFileState({ state: 'ready', request, result })
          }
        })
        .catch(() => {
          if (
            requestSequence === mentionRequestSequence.current &&
            scopeKeyRef.current === requestScopeKey &&
            composerMentionSuggestionMatches(mentionSuggestionRef.current, suggestion)
          ) {
            setMentionFileState({ state: 'error', request })
          }
        })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [hasContextSource, mentionSuggestion, onSearchContext, scopeKey])

  const focusEditor = React.useCallback((position: 'current' | 'end' = 'end') => {
    window.requestAnimationFrame(() => {
      editorRef.current?.focus(position)
    })
  }, [])

  React.useEffect(() => {
    const request = mentionInsertionRequest
    if (!request || request.sequence <= consumedMentionInsertionSequence.current) return

    // Consume every observed sequence, including one from a scope that has
    // already been replaced. Returning to that scope later must not replay it.
    consumedMentionInsertionSequence.current = request.sequence
    if (request.scopeKey !== scopeKey) return

    const inserted = editorRef.current?.insertMentionAtSelection(request.candidate)
    if (!inserted) return
    setSubmitError(null)
    setCommandPickerOpen(false)
    setSlashActiveId(null)
    setMentionActiveId(null)
    mentionSelectionTouched.current = false
    focusEditor('current')
  }, [focusEditor, mentionInsertionRequest, scopeKey])

  const closeCommandPicker = React.useCallback((dismiss: boolean) => {
    if (dismiss) dismissedSlashText.current = editorChange.plainText
    setCommandPickerOpen(false)
    setSlashActiveId(null)
  }, [editorChange.plainText])

  const selectCommand = React.useCallback((candidate: ComposerExecutableCandidate) => {
    if (commandCatalogState.state !== 'ready') return
    if (candidate.kind === 'skill') {
      const projected = projectComposerMentionCandidates([], [candidate]).skills[0]
      if (!projected || !editorRef.current?.replaceLeadingSlashWithMention(projected)) return
    } else {
      if (documentHasSkill) {
        setSubmitError(t('composer.mentions.skillConflict'))
        return
      }
      editorRef.current?.replaceWithPlainText(`/${candidate.name} `)
    }
    dismissedSlashText.current = null
    setCommandPickerOpen(candidate.kind === 'command' && candidate.hasArgumentCompletions)
    setSlashActiveId(null)
    focusEditor()
  }, [commandCatalogState.state, documentHasSkill, focusEditor, t])

  const selectCommandArgument = React.useCallback((
    candidate: ComposerCommandArgumentCandidate,
  ) => {
    const query = commandArgumentQueryRef.current
    if (!query) return
    const nextText = applyComposerSlashArgumentCompletion(
      editorChange.plainText,
      query,
      candidate.value,
    )
    if (nextText === null) return
    if (!editorRef.current?.replaceSlashArgumentCompletion(query, candidate.value)) return
    dismissedSlashText.current = nextText
    setCommandPickerOpen(false)
    setSlashActiveId(null)
    focusEditor('current')
  }, [editorChange.plainText, focusEditor])

  const updateEditor = React.useCallback((next: ComposerEditorChange) => {
    setEditorChange(next)
    setSubmitError((previous) => previous === t('composer.mentions.skillConflict')
      ? null
      : previous)
    const nextSlashQuery = composerSlashQuery(next.plainText)
    const nextArgumentQuery = composerSlashArgumentQuery(
      next.plainTextBeforeCursor,
      next.revision,
    )
    const nextArgumentCommand = nextArgumentQuery
      ? commandProjection.topLevel.find((candidate) =>
        candidate.kind === 'command' &&
        candidate.name === nextArgumentQuery.commandName &&
        candidate.hasArgumentCompletions)
      : undefined
    if (nextSlashQuery === null && (!nextArgumentCommand || !onCompleteCommandArguments)) {
      setCommandPickerOpen(false)
      setSlashActiveId(null)
      dismissedSlashText.current = null
      return
    }
    if (dismissedSlashText.current === next.plainText) return
    dismissedSlashText.current = null
    setCommandPickerOpen(true)
  }, [commandProjection.topLevel, onCompleteCommandArguments, t])

  const extensionCommand = React.useMemo(() => {
    const serialized = serializeComposerDocument(editorChange)
    const name = serialized === null ? '' : commandName(serialized)
    return name
      ? commands.find((command) => command.name === name && command.source === 'extension')
      : undefined
  }, [commands, editorChange])

  const selectMention = React.useCallback((candidate: ComposerMentionCandidate) => {
    if (candidate.kind === 'skill' && leadingSlashConflict) {
      setSubmitError(t('composer.mentions.skillConflict'))
      return
    }
    const suggestion = mentionSuggestionRef.current
    if (!suggestion) return
    if (
      candidate.kind !== 'skill' &&
      (
        mentionFileState.state !== 'ready' ||
        !composerMentionRequestMatches(
          scopeKeyRef.current,
          suggestion,
          mentionFileState.request,
        )
      )
    ) {
      return
    }
    const inserted = editorRef.current?.insertMention(candidate, {
      documentRevision: suggestion.documentRevision,
      from: suggestion.from,
      query: suggestion.query,
      to: suggestion.to,
    }, candidate.kind === 'skill'
      ? (document) => !composerLeadingSlashConflict(document, officialExecutableNames)
      : undefined)
    if (inserted) {
      setSubmitError(null)
      setMentionActiveId(null)
      mentionSelectionTouched.current = false
      focusEditor('current')
    } else if (candidate.kind === 'skill') {
      setSubmitError(t('composer.mentions.skillConflict'))
    }
  }, [focusEditor, leadingSlashConflict, mentionFileState, officialExecutableNames, t])

  const updateMentionSuggestion = React.useCallback((
    suggestion: ComposerEditorSuggestion | null,
  ) => {
    const previousSuggestion = mentionSuggestionRef.current
    mentionSuggestionRef.current = suggestion
    setMentionSuggestion(suggestion)
    if (!suggestion) {
      setMentionActiveId(null)
      mentionSelectionTouched.current = false
      return
    }
    if (!composerMentionSuggestionMatches(previousSuggestion, suggestion)) {
      setMentionActiveId(null)
      mentionSelectionTouched.current = false
    }
    setCommandPickerOpen(false)
    setSlashActiveId(null)
    dismissedSlashText.current = null
  }, [])

  const handleMentionKeyDown = React.useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      editorRef.current?.dismissSuggestion()
      return true
    }
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      mentionSelectionTouched.current = true
      setMentionActiveId(transitionComposerPickerActiveId(
        mentionRows,
        activeMentionId,
        event.key === 'ArrowDown'
          ? 'next'
          : event.key === 'ArrowUp'
            ? 'previous'
            : event.key === 'Home'
              ? 'first'
              : 'last',
      ))
      return true
    }
    if (!isComposerPickerSelectionKey(event)) return false
    const activeCandidate = activeMentionId
      ? mentionCandidateById.get(activeMentionId)
      : undefined
    if (activeCandidate) selectMention(activeCandidate)
    // The open picker owns unmodified Enter/Tab even while its rows are
    // loading or empty. Do not let an incomplete @ query submit or move focus.
    return true
  }, [activeMentionId, mentionCandidateById, mentionRows, selectMention])

  const markMentionSelectionTouched = React.useCallback(() => {
    mentionSelectionTouched.current = true
  }, [])

  const addFiles = React.useCallback((files: readonly File[]) => {
    if (files.length === 0) return
    if (!supportsImages) {
      setSubmitError(t('composer.imageUnsupportedModel'))
      return
    }
    const currentAttachments = attachmentSnapshot.current
    const validationError = validateComposerImageBatch(currentAttachments, files)
    if (validationError) {
      setSubmitError(imageValidationMessage(validationError, t))
      return
    }
    const next = files.map((file): ComposerImageAttachment => ({
      id: crypto.randomUUID(),
      key: composerImageKey(file),
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setSubmitError(null)
    const updated = [...currentAttachments, ...next]
    attachmentSnapshot.current = updated
    setAttachments(updated)
  }, [supportsImages, t])

  const removeAttachment = React.useCallback((id: string) => {
    const updated = attachmentSnapshot.current.filter((attachment) => {
      if (attachment.id !== id) return true
      URL.revokeObjectURL(attachment.previewUrl)
      return false
    })
    attachmentSnapshot.current = updated
    setAttachments(updated)
  }, [])

  const dispatch = React.useCallback(async (action: SubmitAction) => {
    const capturedDocument: ComposerDocumentSnapshot = editorRef.current?.capture() ?? editorChange
    const message = serializeComposerDocument(capturedDocument)
    const capturedAttachments = attachmentSnapshot.current
    if (message === null) {
      setSubmitError(t('composer.mentions.invalidDocument'))
      return
    }
    const capturedConflict = composerDocumentHasSkill(capturedDocument.document)
      ? composerLeadingSlashConflict(capturedDocument.document, officialExecutableNames)
      : null
    if (capturedConflict) {
      setSubmitError(t('composer.mentions.skillConflict'))
      return
    }
    if ((!message.trim() && capturedAttachments.length === 0) || submitting) return
    if (action !== 'prompt' && !message.trim() && capturedAttachments.length > 0) {
      setSubmitError(t('composer.queueImageNeedsText'))
      return
    }
    if (capturedAttachments.length > 0 && !supportsImages) {
      setSubmitError(t('composer.imageUnsupportedModel'))
      return
    }
    const capturedScopeKey = scopeKeyRef.current
    setSubmitting(true)
    setSubmitError(null)
    try {
      const images = await attachmentsToPiImagesIfCurrent(
        capturedAttachments,
        () => scopeKeyRef.current === capturedScopeKey,
      )
      if (!images) return
      await onSubmit(message, action, images)
      if (scopeKeyRef.current !== capturedScopeKey) return
      const currentDocument = editorRef.current?.capture()
      if (currentDocument && shouldClearCapturedComposer(
        capturedScopeKey,
        scopeKeyRef.current,
        capturedDocument.revision,
        currentDocument.revision,
      )) {
        editorRef.current?.clearIfRevision(capturedDocument.revision)
      }
      const attachmentIds = new Set(capturedAttachments.map((attachment) => attachment.id))
      const remainingAttachments = attachmentSnapshot.current.filter((attachment) => {
        if (!attachmentIds.has(attachment.id)) return true
        URL.revokeObjectURL(attachment.previewUrl)
        return false
      })
      attachmentSnapshot.current = remainingAttachments
      setAttachments(remainingAttachments)
    } catch (error) {
      if (scopeKeyRef.current === capturedScopeKey) {
        setSubmitError(error instanceof Error ? error.message : t('composer.sendFailed'))
      }
    } finally {
      if (scopeKeyRef.current === capturedScopeKey) setSubmitting(false)
    }
  }, [
    attachments,
    editorChange,
    officialExecutableNames,
    onSubmit,
    submitting,
    supportsImages,
    t,
  ])

  const submitMode = deriveComposerSubmitMode(isStreaming, Boolean(extensionCommand))
  const primaryAction = submitMode.action
  const hasSubmission = Boolean(editorChange.hasContent || attachments.length > 0)

  const handleEditorKeyDown = React.useCallback((event: KeyboardEvent) => {
    if (commandPickerOpen) {
      if (event.key === 'Escape') {
        closeCommandPicker(true)
        return true
      }
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        setSlashActiveId(transitionComposerPickerActiveId(
          slashRows,
          activeSlashId,
          event.key === 'ArrowDown'
            ? 'next'
            : event.key === 'ArrowUp'
              ? 'previous'
              : event.key === 'Home'
                ? 'first'
                : 'last',
        ))
        return true
      }
      if (isComposerPickerSelectionKey(event)) {
        if (commandArgumentQuery) {
          const selected = activeSlashId
            ? commandArgumentCandidateById.get(activeSlashId)
            : undefined
          if (selected) selectCommandArgument(selected)
          return true
        }
        const selected = activeSlashId ? slashCandidateById.get(activeSlashId) : undefined
        if (selected) selectCommand(selected)
        // Loading, empty, and error rows are non-selectable, but the open
        // picker still owns Enter/Tab so it cannot submit stale text.
        return true
      }
    }
    if (!isComposerSendShortcut(event, sendShortcut)) return false
    void dispatch(primaryAction)
    return true
  }, [
    activeSlashId,
    closeCommandPicker,
    commandPickerOpen,
    commandArgumentCandidateById,
    commandArgumentQuery,
    dispatch,
    primaryAction,
    sendShortcut,
    selectCommand,
    selectCommandArgument,
    slashCandidateById,
    slashRows,
  ])

  const stop = React.useCallback(async () => {
    setSubmitError(null)
    try {
      await onStop()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t('composer.sendFailed'))
    }
  }, [onStop, t])

  const visibleError = submitError ?? (submissionConflict ? conflictMessage : modelError)

  return (
    <div data-composer-root className="shrink-0 bg-background px-3 pb-3 pt-2">
      <div className="mx-auto min-w-0 w-full max-w-[920px]">
        <div
          data-composer-surface
          data-composer-mode={isStreaming ? 'running' : 'idle'}
          aria-busy={submitting}
          className={cn(
            'min-w-0 rounded-lg border border-input bg-card transition-[border-color,box-shadow] duration-(--duration-fast) focus-within:border-sage/50 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-sage)_10%,transparent)] motion-reduce:transition-none',
            dragging && 'border-sage bg-sage/5',
          )}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault()
              setDragging(true)
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            addFiles([...event.dataTransfer.files])
          }}
        >
          {attachments.length > 0 ? (
            <div
              data-composer-attachments
              className="scroll-slim grid max-h-28 min-w-0 grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-1.5 overflow-y-auto px-2 pt-2"
            >
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="group/image relative flex h-14 min-w-0 overflow-hidden rounded-md border border-border bg-muted/70"
                >
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.file.name}
                    className="size-14 shrink-0 object-cover"
                  />
                  <div className="min-w-0 flex-1 self-center px-2 pr-7">
                    <p
                      className="truncate text-caption font-medium text-foreground"
                      title={attachment.file.name}
                    >
                      {attachment.file.name}
                    </p>
                    <p className="mt-0.5 text-micro tabular-nums text-muted-foreground">
                      {attachmentSize(attachment.file.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${t('composer.removeImage')} ${attachment.file.name}`}
                    className="absolute right-1 top-1 grid size-5 place-items-center rounded-sm bg-background/90 text-foreground opacity-0 outline-none transition-[background-color,opacity] duration-(--duration-fast) hover:bg-background focus-visible:opacity-100 focus-visible:focus-ring group-hover/image:opacity-100 motion-reduce:transition-none"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <TbX className="size-3" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <SkillPicker
            activeId={mentionSuggestion ? activeMentionId : activeSlashId}
            ariaLabel={mentionSuggestion
              ? t('composer.mentions.menuLabel')
              : commandArgumentQuery
                ? t('composer.commandArgumentsMenuLabel')
                : t('composer.commandMenuLabel')}
            listboxId={mentionSuggestion
              ? COMPOSER_MENTION_LISTBOX_ID
              : COMPOSER_SLASH_LISTBOX_ID}
            open={Boolean(mentionSuggestion || commandPickerOpen)}
            rows={mentionSuggestion ? mentionRows : slashRows}
            onActiveIdChange={mentionSuggestion ? setMentionActiveId : setSlashActiveId}
            onActiveIdInteraction={mentionSuggestion
              ? markMentionSelectionTouched
              : undefined}
            onEscapeKeyDown={() => {
              if (mentionSuggestion) {
                editorRef.current?.dismissSuggestion()
              }
            }}
            onOpenChange={(open) => {
              if (open) return
              // Radix requests a close before TipTap reports its outside-click
              // exit. Keep that distinct from an explicit editor dismissal so
              // a file-tree context-menu action can still replace the exact,
              // unchanged @ query. Escape clears the preserved target through
              // handleMentionKeyDown instead.
              if (mentionSuggestion) {
                return
              }
              closeCommandPicker(true)
            }}
            onSelect={(id) => {
              if (mentionSuggestion) {
                const candidate = mentionCandidateById.get(id)
                if (candidate) selectMention(candidate)
              } else {
                if (commandArgumentQuery) {
                  const candidate = commandArgumentCandidateById.get(id)
                  if (candidate) selectCommandArgument(candidate)
                } else {
                  const candidate = slashCandidateById.get(id)
                  if (candidate) selectCommand(candidate)
                }
              }
            }}
            anchor={(
              <div className="rounded-t-lg">
                <ComposerEditor
                  ref={editorRef}
                  activeDescendantId={mentionSuggestion && activeMentionId
                    ? composerPickerOptionId(COMPOSER_MENTION_LISTBOX_ID, activeMentionId)
                    : commandPickerOpen && activeSlashId
                      ? composerPickerOptionId(COMPOSER_SLASH_LISTBOX_ID, activeSlashId)
                      : undefined}
                  ariaControlsId={mentionSuggestion
                    ? COMPOSER_MENTION_LISTBOX_ID
                    : commandPickerOpen
                      ? COMPOSER_SLASH_LISTBOX_ID
                      : undefined}
                  ariaExpanded={Boolean(mentionSuggestion || commandPickerOpen)}
                  ariaLabel={t('composer.inputLabel')}
                  ariaDescribedBy={visibleError ? 'composer-input-error' : undefined}
                  ariaInvalid={Boolean(visibleError)}
                  disabled={false}
                  placeholder={t('composer.inputPlaceholder')}
                  onChange={updateEditor}
                  onKeyDown={handleEditorKeyDown}
                  onMentionKeyDown={handleMentionKeyDown}
                  onPasteFiles={addFiles}
                  onSuggestionChange={updateMentionSuggestion}
                />
              </div>
            )}
          />
          <div
            data-composer-toolbar
            className="flex min-h-10 min-w-0 items-center gap-1 px-2 pb-2 pt-0.5"
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              tabIndex={-1}
              className="sr-only"
              aria-hidden="true"
              onChange={(event) => {
                addFiles([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!connected || !supportsImages}
                  aria-label={t('composer.addFile')}
                  onClick={() => fileInput.current?.click()}
                >
                  <TbPlus aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {supportsImages ? t('composer.addFile') : t('composer.imageUnsupportedModel')}
              </TooltipContent>
            </Tooltip>
            <ModelPicker
              models={models}
              selected={selectedModel}
              connected={connected}
              loading={loadingModels}
              error={modelError}
              onSelect={onModelChange}
            />
            <ThinkingPicker
              connected={connected}
              levels={thinkingLevels}
              selected={selectedThinkingLevel}
              onSelect={onThinkingChange}
            />
            <QueuePopover
              queue={queue}
              onSetQueueMode={onSetQueueMode}
              onPromoteFollowUp={onPromoteFollowUp}
            />

            <div className="min-w-1 flex-1" />

            {isStreaming ? (
              <div
                className="flex h-8 shrink-0 items-center gap-1.5"
                data-composer-running-actions
              >
                <div className="flex h-8 shrink-0 overflow-hidden rounded-md border border-border bg-background/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-none border-0 px-2.5 text-caption"
                    disabled={!hasSubmission || submitting || Boolean(submissionConflict)}
                    aria-label={submitMode.kind === 'run-now' ? t('composer.runNow') : t('composer.queue')}
                    onClick={() => void dispatch(primaryAction)}
                  >
                    {submitMode.kind === 'run-now'
                      ? <TbArrowUp aria-hidden />
                      : <TbListDetails aria-hidden />}
                    {submitMode.kind === 'run-now' ? t('composer.runNow') : t('composer.queue')}
                  </Button>
                  {submitMode.allowsSteer ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-8 w-7 rounded-none border-l border-border"
                          disabled={!hasSubmission || submitting || Boolean(submissionConflict)}
                          aria-label={t('composer.moreSubmitActions')}
                        >
                          <TbChevronDown aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void dispatch('steer')}>
                          <TbRoute aria-hidden />
                          {t('composer.steer')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="accent"
                      size="icon-sm"
                      className="rounded-lg"
                      onClick={() => void stop()}
                      aria-label={t('composer.stop')}
                    >
                      <TbPlayerStop aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('composer.stop')}</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <Button
                variant="accent"
                size="icon-sm"
                className="rounded-lg"
                onClick={() => void dispatch(submitMode.action)}
                disabled={!hasSubmission || submitting || !connected || Boolean(submissionConflict)}
                aria-label={t('composer.send')}
              >
                <TbArrowUp aria-hidden />
              </Button>
            )}
          </div>
        </div>

        {visibleError ? (
          <p
            id="composer-input-error"
            className="mt-1.5 px-2 text-caption text-destructive"
            role="alert"
          >
            {visibleError}
          </p>
        ) : null}
        <p className="mt-1.5 px-2 text-center text-micro text-muted-foreground">
          {t('composer.disclaimer')}
        </p>
      </div>
    </div>
  )
}
