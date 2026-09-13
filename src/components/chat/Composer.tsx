import * as React from 'react'
import {
  TbArrowUp,
  TbLoader2,
  TbListDetails,
  TbPlayerStop,
  TbPlus,
  TbRoute,
  TbX,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from './markdown/MarkdownContent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  LocalPiCommandArgumentCompletion,
  LocalPiImageContent,
  LocalPiSlashCommand,
  LocalPiThinkingLevel,
} from '@/shared/local-pi'
import type {
  ComposerSendShortcut,
  RunningSubmitPreference,
} from '@/shared/settings'
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
import {
  deriveComposerActionState,
  type ComposerQueueMode,
  type ComposerQueueState,
  type ComposerSubmitAction,
} from '@/renderer/composer/composer-controls'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import { ModelPicker, type PiModelOption } from './ModelPicker'
import { PendingMessageRail } from './PendingMessageRail'
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

type SubmitAction = ComposerSubmitAction

export type { ComposerQueueState } from '@/renderer/composer/composer-controls'

export type ComposerCommandCatalogState =
  | { state: 'unavailable' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready' }

export interface ComposerMentionInsertionRequest {
  candidate: ComposerPathMentionCandidate
  scopeKey: string
  sequence: number
}

export interface ComposerProps {
  connected: boolean
  loadingModels: boolean
  modelError?: string | null
  availabilityError?: string | null
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
  operationOwnerKey?: string
  sendShortcut: ComposerSendShortcut
  runningSubmitPreference: RunningSubmitPreference
  supportsImages: boolean
  onModelChange(providerId: string, modelId: string): void | Promise<void>
  onSubmit(
    text: string,
    action: SubmitAction,
    images?: readonly LocalPiImageContent[],
  ): Promise<void>
  onStop(): void | Promise<void>
  onThinkingChange(level: LocalPiThinkingLevel): void | Promise<void>
  onRunningSubmitPreferenceChange(value: RunningSubmitPreference): void
  onSetQueueMode(kind: 'steering' | 'followUp', mode: ComposerQueueMode): Promise<void>
  onPromoteFollowUp(itemId: string): Promise<void>
  onRemoveQueuedMessage(itemId: string): Promise<void>
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
  availabilityError,
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
  operationOwnerKey = scopeKey,
  sendShortcut,
  runningSubmitPreference,
  supportsImages,
  onModelChange,
  onSubmit,
  onStop,
  onThinkingChange,
  onRunningSubmitPreferenceChange,
  onSetQueueMode,
  onPromoteFollowUp,
  onRemoveQueuedMessage,
  onCompleteCommandArguments,
  onSearchContext,
}: ComposerProps) {
  const t = useT()
  const hasContextSource = onSearchContext !== undefined
  const [editorChange, setEditorChange] = React.useState(initialEditorChange)
  const [attachments, setAttachments] = React.useState<ComposerImageAttachment[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [submitError, setSubmitError] = React.useState<string | null>(null)
  const submitFeedback = useConversationOperationFeedback(operationOwnerKey)
  const stopFeedback = useConversationOperationFeedback(operationOwnerKey)
  const submitting = Boolean(submitFeedback.pending)
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
    editorRef.current?.focus(position)
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
    if (!connected || submitting) return
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
    setSubmitError(null)
    await submitFeedback.run(action, async (isCurrent) => {
      const images = await attachmentsToPiImagesIfCurrent(
        capturedAttachments,
        () => isCurrent() && scopeKeyRef.current === capturedScopeKey,
      )
      if (!images || !isCurrent()) return
      await onSubmit(message, action, images)
      if (!isCurrent() || scopeKeyRef.current !== capturedScopeKey) return
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
    }, t('composer.sendFailed'))
  }, [
    connected,
    editorChange,
    officialExecutableNames,
    onSubmit,
    submitting,
    submitFeedback.run,
    supportsImages,
    t,
  ])

  const actionState = deriveComposerActionState({
    ready: connected,
    isStreaming,
    hasExtensionCommand: Boolean(extensionCommand),
    runningSubmitPreference,
    hasContent: editorChange.hasContent,
    imageCount: attachments.length,
    supportsImages,
    hasConflict: Boolean(submissionConflict),
    submitting,
    stopping: Boolean(stopFeedback.pending),
  })
  const submitMode = actionState.submit
  const primaryAction = submitMode.action

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
    if (actionState.canSubmit) void dispatch(primaryAction)
    return true
  }, [
    activeSlashId,
    actionState.canSubmit,
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
    if (!actionState.canStop) return
    await stopFeedback.run('stop', () => onStop(), t('composer.stopFailed'))
  }, [actionState.canStop, onStop, stopFeedback.run, t])

  const visibleError = submitError ?? submitFeedback.error ??
    (submissionConflict ? conflictMessage : null) ??
    (attachments.length > 0 && !supportsImages
      ? t('composer.imageUnsupportedModel')
      : primaryAction !== 'prompt' && attachments.length > 0 && !editorChange.hasContent
        ? t('composer.queueImageNeedsText')
        : null)
  const submitLabel = t(submitMode.kind === 'queue'
    ? 'composer.queue'
    : submitMode.kind === 'steer'
      ? 'composer.steer'
      : submitMode.kind === 'run-now'
        ? 'composer.runNow'
        : 'composer.send')
  const SubmitIcon = submitMode.kind === 'queue'
    ? TbListDetails
    : submitMode.kind === 'steer' ? TbRoute : TbArrowUp

  return (
    <div data-composer-root className="shrink-0 bg-background px-6 pb-4 pt-3">
      <div className="mx-auto min-w-0 w-full max-w-(--conversation-width)">
        <PendingMessageRail
          key={operationOwnerKey}
          operationOwnerKey={operationOwnerKey}
          queue={queue}
          runningSubmitPreference={runningSubmitPreference}
          onRunningSubmitPreferenceChange={onRunningSubmitPreferenceChange}
          onSetQueueMode={onSetQueueMode}
          onPromoteFollowUp={onPromoteFollowUp}
          onRemoveQueuedMessage={onRemoveQueuedMessage}
        />
        <div
          data-composer-surface
          data-composer-mode={isStreaming ? 'running' : 'idle'}
          aria-busy={submitting}
          className={cn(
            'min-w-0 border border-input/70 bg-composer shadow-(--shadow-composer) transition-colors duration-(--duration-fast) focus-within:border-ring/70 motion-reduce:transition-none',
            queue.pendingCount > 0 ? 'rounded-b-(--radius-composer) rounded-t-none' : 'rounded-(--radius-composer)',
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
            className="flex min-h-11 min-w-0 items-center gap-1 px-3 pb-2.5 pt-1"
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
            <div className="min-w-1 flex-1" />
            <ModelPicker
              key={operationOwnerKey}
              operationOwnerKey={operationOwnerKey}
              models={models}
              selected={selectedModel}
              thinkingLevels={thinkingLevels}
              selectedThinkingLevel={selectedThinkingLevel}
              connected={connected}
              loading={loadingModels}
              error={modelError}
              onSelect={onModelChange}
              onThinkingSelect={onThinkingChange}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  onClick={() => void dispatch(submitMode.action)}
                  disabled={!actionState.canSubmit}
                  aria-label={submitLabel}
                  data-composer-submit={submitMode.kind}
                >
                  {submitting
                    ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                    : <SubmitIcon aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{submitLabel}</TooltipContent>
            </Tooltip>
            {isStreaming ? (
              <div className="flex h-8 shrink-0 items-center" data-composer-running-actions>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="rounded-full"
                      onClick={() => void stop()}
                      disabled={!actionState.canStop}
                      aria-label={t('composer.stop')}
                      aria-busy={Boolean(stopFeedback.pending)}
                    >
                      {stopFeedback.pending
                        ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                        : <TbPlayerStop aria-hidden />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('composer.stop')}</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
          </div>
        </div>

        {visibleError ? (
          <div
            id="composer-input-error"
            className="mt-1.5 px-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive"
            role="alert"
          >
            <MarkdownContent markdown={visibleError} />
          </div>
        ) : null}
        {stopFeedback.error ? (
          <div className="mt-1.5 px-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive" role="alert" data-composer-stop-error>
            <MarkdownContent markdown={stopFeedback.error} />
          </div>
        ) : null}
        {availabilityError ? (
          <div className="mt-1.5 px-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive" role="status" data-composer-availability-error>
            <MarkdownContent markdown={availabilityError} />
          </div>
        ) : null}
        <p className="mt-1.5 px-2 text-center text-micro text-muted-foreground">
          {t('composer.disclaimer')}
        </p>
      </div>
    </div>
  )
}
