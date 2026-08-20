import * as React from 'react'
import { TbLayoutDashboard, TbLoader2, TbServer } from 'react-icons/tb'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ActivityRail,
  type RailDestination,
} from '@/components/frame/ActivityRail'
import { ContextPanel, ContextPanelNav } from '@/components/frame/ContextPanel'
import { CommandPalette } from '@/components/frame/CommandPalette'
import { SessionsPanel } from '@/components/frame/SessionsPanel'
import type { SidebarConversationItem } from '@/components/layout/SessionList'
import { ChatHeader } from '@/components/chat/ChatHeader'
import {
  MessageList,
  type ConversationJumpRequest,
} from '@/components/chat/MessageList'
import {
  Composer,
  type ComposerCommandCatalogState,
  type ComposerQueueState,
} from '@/components/chat/Composer'
import { ExtensionUiDialog } from '@/components/chat/ExtensionUiDialog'
import { ActiveControlBar } from '@/components/chat/ExtensionSurfaces'
import { InspectorPanel } from '@/components/inspector/InspectorPanel'
import { PanelResizeHandle } from '@/components/layout/PanelResizeHandle'
import {
  SETTINGS_SECTIONS,
  SettingsLayout,
  isSettingsSectionId,
  type IntegrationsTabId,
  type SettingsSectionId,
} from '@/components/settings/SettingsLayout'
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings'
import {
  type CommandContext,
  type SessionCommandEntry,
} from '@/lib/commands'
import { useApplySettings } from '@/lib/theme'
import { useT } from '@/i18n'
import {
  cancelPiGenerationHydrationWaiter,
  derivePiConversationPresentation,
  piGenerationHydrationOutcome,
  usePiExtensionUi,
  usePiRpcActions,
  usePiRuntime,
  usePiTranscript,
} from '@/store/pi-rpc'
import {
  conversationScopeKey,
  useWorkspaceStore,
} from '@/store/workspace'
import { opensMcpSettings } from '@/renderer/mcp/mcp-command-routing'
import {
  readContextPanelOpen,
  writeContextPanelOpen,
} from '@/renderer/layout-preferences'
import type { LocalPiImageContent } from '@/shared/local-pi'
import type { ConversationActivationResult } from '@/shared/conversation-scope'
import type {
  SubagentInspectorFocusRequest,
  SubagentInspectorSelection,
} from '@/types/chat'
import {
  goalActionRoute,
  planActionRoute,
  type GoalActionId,
  type PlanActionId,
} from '@/renderer/pi-rpc/adapters'

const CONTEXT_PANEL_MIN = 200
const CONTEXT_PANEL_DEFAULT = 240
const CONTEXT_PANEL_MAX = 320
const INSPECTOR_MIN = 280
const INSPECTOR_MAX = 480
const INSPECTOR_DEFAULT = 360
const EMPTY_COMPOSER_QUEUE: ComposerQueueState = Object.freeze({
  pendingCount: 0,
  detailsKnown: false,
  steering: [],
  followUp: [],
  steeringMode: 'one-at-a-time',
  followUpMode: 'one-at-a-time',
})

interface FrameNav {
  rail: RailDestination
  contextPanelOpen: boolean
  inspectorOpen: boolean
  paletteOpen: boolean
}

interface SessionOpening {
  operationId: number
  scopeKey: string
  selectionToken: string
  activation: ConversationActivationResult | null
  title: string
  error: string | null
}

interface SessionOpeningHandle extends SessionOpening {
  hydration: Promise<boolean>
  resolveHydration(success: boolean): void
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : null
}

export default function App() {
  const settings = useApplySettings()
  const t = useT()
  const workspace = useWorkspaceStore()
  const pi = usePiRuntime()
  const transcript = usePiTranscript()
  const actions = usePiRpcActions()
  const extension = usePiExtensionUi()

  const [frameNav, setFrameNav] = React.useState<FrameNav>(() => ({
    rail: 'sessions',
    contextPanelOpen: readContextPanelOpen(),
    inspectorOpen: true,
    paletteOpen: false,
  }))
  const [settingsSection, setSettingsSection] = React.useState<SettingsSectionId>('appearance')
  const [integrationsTab, setIntegrationsTab] = React.useState<IntegrationsTabId>('overview')
  const [renamingToken, setRenamingToken] = React.useState<string | null>(null)
  const [openingSession, setOpeningSession] = React.useState<SessionOpening | null>(null)
  const openingSessionRef = React.useRef<SessionOpeningHandle | null>(null)
  const openingSessionSequence = React.useRef(0)
  const [inspectorWidth, setInspectorWidth] = React.useState(INSPECTOR_DEFAULT)
  const [contextPanelWidth, setContextPanelWidth] = React.useState(CONTEXT_PANEL_DEFAULT)
  const [pendingDeletion, setPendingDeletion] = React.useState<
    SidebarConversationItem | null
  >(null)
  const [deletingSelectionToken, setDeletingSelectionToken] = React.useState<string | null>(
    null,
  )
  const [deletionError, setDeletionError] = React.useState<string | null>(null)
  const [conversationJump, setConversationJump] = React.useState<
    ConversationJumpRequest | null
  >(null)
  const conversationJumpSequence = React.useRef(0)
  const [subagentSelection, setSubagentSelection] = React.useState<
    SubagentInspectorSelection | null
  >(null)
  const [subagentFocusRequest, setSubagentFocusRequest] = React.useState<
    SubagentInspectorFocusRequest | null
  >(null)
  const subagentSelectionSequence = React.useRef(0)
  const subagentFocusSequence = React.useRef(0)

  React.useEffect(() => () => {
    cancelPiGenerationHydrationWaiter(openingSessionRef)
  }, [])

  React.useEffect(() => {
    writeContextPanelOpen(frameNav.contextPanelOpen)
  }, [frameNav.contextPanelOpen])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        setFrameNav((current) => ({ ...current, contextPanelOpen: !current.contextPanelOpen }))
      } else if (key === 'j') {
        event.preventDefault()
        setFrameNav((current) => ({ ...current, inspectorOpen: !current.inspectorOpen }))
      } else if (key === 'k') {
        event.preventDefault()
        setFrameNav((current) => ({ ...current, paletteOpen: !current.paletteOpen }))
      } else if (event.key === '1') {
        event.preventDefault()
        setFrameNav((current) => ({ ...current, rail: 'sessions' }))
      } else if (event.key === '2') {
        event.preventDefault()
        setFrameNav((current) => ({ ...current, rail: 'integrations' }))
      } else if (event.key === '3') {
        event.preventDefault()
        setFrameNav((current) => ({ ...current, rail: 'settings' }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setRail = React.useCallback((rail: RailDestination) => {
    setFrameNav((current) => (current.rail === rail ? current : { ...current, rail }))
  }, [])
  const toggleContextPanel = React.useCallback(() => {
    setFrameNav((current) => ({ ...current, contextPanelOpen: !current.contextPanelOpen }))
  }, [])
  const toggleInspector = React.useCallback(() => {
    setFrameNav((current) => ({ ...current, inspectorOpen: !current.inspectorOpen }))
  }, [])
  const openPalette = React.useCallback(() => {
    setFrameNav((current) => ({ ...current, paletteOpen: true }))
  }, [])

  const run = React.useCallback((operation: () => Promise<void>) => {
    void operation().catch(() => undefined)
  }, [])

  const abandonSessionOpening = React.useCallback((preserveOperationId?: number) => {
    const opening = openingSessionRef.current
    if (!opening) {
      setOpeningSession((current) => current?.error ? null : current)
      return
    }
    if (opening.operationId === preserveOperationId) return
    cancelPiGenerationHydrationWaiter(openingSessionRef)
    setOpeningSession((current) =>
      current?.operationId === opening.operationId ? null : current)
  }, [])

  const requestSwitch = React.useCallback(
    (
      operation: () => Promise<void>,
      sessionOpeningOperationId?: number,
    ) => {
      abandonSessionOpening(sessionOpeningOperationId)
      run(operation)
    },
    [abandonSessionOpening, run],
  )

  const beginSessionOpening = React.useCallback((item: SidebarConversationItem) => {
    abandonSessionOpening()
    const operationId = ++openingSessionSequence.current
    let resolveHydration: (success: boolean) => void = () => undefined
    const hydration = new Promise<boolean>((resolve) => {
      resolveHydration = resolve
    })
    const opening: SessionOpeningHandle = {
      operationId,
      scopeKey: conversationScopeKey(item.summary.scope),
      selectionToken: item.summary.selectionToken,
      activation: null,
      title: item.summary.name?.trim() || item.summary.preview.trim() ||
        t('sidebar.session.untitled'),
      error: null,
      hydration,
      resolveHydration,
    }
    openingSessionRef.current = opening
    setOpeningSession({
      operationId: opening.operationId,
      scopeKey: opening.scopeKey,
      selectionToken: opening.selectionToken,
      activation: opening.activation,
      title: opening.title,
      error: opening.error,
    })
    return opening
  }, [abandonSessionOpening, t])

  const confirmSessionOpeningActivation = React.useCallback((
    operationId: number,
    activation: ConversationActivationResult,
  ) => {
    const opening = openingSessionRef.current
    if (!opening || opening.operationId !== operationId) return false
    if (conversationScopeKey(activation.scope) !== opening.scopeKey) {
      throw new Error('Pi activated a session in another conversation scope.')
    }
    opening.activation = activation
    setOpeningSession((current) => current?.operationId === operationId
      ? { ...current, activation }
      : current)
    return true
  }, [])

  const settleSessionOpening = React.useCallback((
    operationId: number,
    outcome: { status: 'ready' | 'cancelled' } | { status: 'error'; error: string },
  ) => {
    const opening = openingSessionRef.current
    if (!opening || opening.operationId !== operationId) return
    openingSessionRef.current = null
    opening.resolveHydration(outcome.status === 'ready')
    setOpeningSession((current) => {
      if (current?.operationId !== operationId) return current
      return outcome.status === 'error'
        ? { ...current, error: outcome.error }
        : null
    })
  }, [])

  React.useEffect(() => {
    const opening = openingSession
    if (!opening || opening.error || !opening.activation) return
    const outcome = piGenerationHydrationOutcome(
      {
        scopeKey: conversationScopeKey(opening.activation.scope),
        generation: opening.activation.generation,
        sessionId: opening.activation.sessionId,
      },
      conversationScopeKey(workspace.activeScope),
      workspace.activeSessionId,
      pi.runtime,
      pi.session,
      pi.hydration,
      pi.loading,
      transcript.loading,
    )
    if (outcome === 'ready') {
      settleSessionOpening(opening.operationId, { status: 'ready' })
    } else if (outcome === 'error') {
      settleSessionOpening(opening.operationId, {
        status: 'error',
        error: pi.hydration.error || pi.error || 'Pi failed to load the selected session.',
      })
    }
  }, [
    openingSession,
    pi.hydration,
    pi.loading,
    pi.runtime,
    pi.session,
    settleSessionOpening,
    transcript.loading,
    workspace.activeSessionId,
  ])

  const requestSessionOpening = React.useCallback((
    item: SidebarConversationItem,
    afterHydration?: () => Promise<void>,
  ) => {
    const opening = beginSessionOpening(item)
    if (!opening) return
    requestSwitch(
      async () => {
        try {
          const activation = await workspace.openSession(
            item.summary.scope,
            item.summary.selectionToken,
          )
          if (!confirmSessionOpeningActivation(opening.operationId, activation)) return
          if (await opening.hydration) await afterHydration?.()
        } catch (error) {
          settleSessionOpening(opening.operationId, {
            status: 'error',
            error: errorMessage(error) || 'Pi failed to open the selected session.',
          })
          throw error
        }
      },
      opening.operationId,
    )
    setRail('sessions')
  }, [
    beginSessionOpening,
    confirmSessionOpeningActivation,
    requestSwitch,
    setRail,
    settleSessionOpening,
    workspace,
  ])

  const active = workspace.sessions.find((session) =>
    session.id === workspace.activeSessionId)
  const conversation = derivePiConversationPresentation({
    activeScopeKey: conversationScopeKey(workspace.activeScope),
    activeSessionId: workspace.activeSessionId,
    activation: openingSession
      ? openingSession.error
        ? { status: 'error', error: openingSession.error }
        : { status: 'loading' }
      : null,
    runtime: pi.runtime,
    session: pi.session,
    hydration: pi.hydration,
    runtimeLoading: pi.loading,
    transcriptLoading: transcript.loading,
  })
  const conversationReady = conversation.status === 'ready'
  const conversationSessionKey = conversationReady
    ? `${conversationScopeKey(workspace.activeScope)}:${conversation.sessionId}:${pi.runtime?.generation ?? 'none'}`
    : null
  const selectedSubagentCall = React.useMemo(() => {
    if (
      !subagentSelection ||
      !conversationSessionKey ||
      subagentSelection.sessionKey !== conversationSessionKey
    ) return null
    for (const turn of transcript.turns) {
      if (
        turn.kind === 'tool' &&
        turn.call.id === subagentSelection.toolCallId &&
        turn.call.subagent
      ) return turn.call
    }
    return null
  }, [conversationSessionKey, subagentSelection, transcript.turns])

  React.useEffect(() => {
    if (subagentSelection && !selectedSubagentCall) setSubagentSelection(null)
  }, [selectedSubagentCall, subagentSelection])

  React.useEffect(() => {
    setConversationJump(null)
    setSubagentFocusRequest(null)
  }, [conversationSessionKey])
  const navigateConversationOutline = React.useCallback((entryId: string) => {
    if (!conversationSessionKey) return
    setConversationJump({
      sessionKey: conversationSessionKey,
      entryId,
      sequence: ++conversationJumpSequence.current,
    })
  }, [conversationSessionKey])
  const closeSubagentExecution = React.useCallback(() => {
    if (!subagentSelection) return
    setSubagentFocusRequest({
      sessionKey: subagentSelection.sessionKey,
      toolCallId: subagentSelection.toolCallId,
      sequence: ++subagentFocusSequence.current,
    })
    setSubagentSelection(null)
  }, [subagentSelection])
  const openSubagentExecution = React.useCallback((toolCallId: string) => {
    if (!conversationSessionKey) return
    if (
      subagentSelection?.sessionKey === conversationSessionKey &&
      subagentSelection.toolCallId === toolCallId
    ) {
      closeSubagentExecution()
      return
    }
    setSubagentFocusRequest(null)
    setSubagentSelection({
      sessionKey: conversationSessionKey,
      toolCallId,
      sequence: ++subagentSelectionSequence.current,
    })
    setFrameNav((current) => current.inspectorOpen
      ? current
      : { ...current, inspectorOpen: true })
  }, [closeSubagentExecution, conversationSessionKey, subagentSelection])
  const commandCatalogState: ComposerCommandCatalogState = conversation.status === 'empty'
    ? { state: 'unavailable' }
    : conversation.status === 'loading'
      ? { state: 'loading' }
      : conversation.status === 'error'
        ? { state: 'error', message: conversation.error }
        : { state: 'ready' }
  const title = openingSession?.title || (conversationReady
    ? extension.title || pi.session?.sessionName || active?.title ||
      t('sidebar.session.untitled')
    : t('sidebar.session.untitled'))
  const selectedModel = conversationReady ? pi.selectedModel : null
  const piExecutableUnavailable = workspace.errorCode === 'PI_EXECUTABLE_UNAVAILABLE'

  const isOpeningSessionRow = React.useCallback((
    summary: SidebarConversationItem['summary'],
  ) => Boolean(
    openingSession &&
    !openingSession.error &&
    (
      summary.selectionToken === openingSession.selectionToken ||
      (
        openingSession.activation !== null &&
        pi.runtime?.generation === openingSession.activation.generation &&
        conversationScopeKey(summary.scope) === openingSession.scopeKey &&
        summary.sessionId === openingSession.activation.sessionId
      )
    )
  ), [openingSession, pi.runtime?.generation])

  const openConversation = React.useCallback((item: SidebarConversationItem) => {
    requestSessionOpening(item)
  }, [requestSessionOpening])

  const newPrimarySession = React.useCallback(() => {
    requestSwitch(() => workspace.newSession(workspace.activeScope))
    setRail('sessions')
  }, [requestSwitch, setRail, workspace])

  const commandContext = React.useMemo<CommandContext>(() => ({
    generating: conversationReady && (pi.session?.isStreaming ?? false),
    setRail,
    toggleContextPanel,
    toggleInspector,
    newSession: newPrimarySession,
    openSettingsSection: (section) => {
      setSettingsSection(section)
      setRail('settings')
    },
    openIntegrationsTab: (tab) => {
      setIntegrationsTab(tab)
      setRail('integrations')
    },
    stopGeneration: () => void actions.abort(),
    selectSession: openConversation,
  }), [
    actions,
    conversationReady,
    newPrimarySession,
    openConversation,
    pi.session?.isStreaming,
    setRail,
    toggleContextPanel,
    toggleInspector,
  ])

  const paletteSessions = React.useMemo<SessionCommandEntry[]>(() => {
    const entries: SessionCommandEntry[] = []
    for (const catalog of Object.values(workspace.sessionCatalogs)) {
      for (const summary of catalog.rows) {
        const scope = summary.scope
        entries.push({
          item: { summary },
          title: summary.name?.trim() || summary.preview.trim() ||
            t('sidebar.session.untitled'),
          groupLabel: scope.kind === 'project'
            ? workspace.recentProjects.find((project) =>
                project.id === scope.workspaceId)?.name ?? t('sidebar.projects')
            : t('sidebar.recent'),
        })
      }
    }
    return entries
  }, [t, workspace.recentProjects, workspace.sessionCatalogs])

  const submitComposer = React.useCallback(async (
    text: string,
    action: 'prompt' | 'follow_up' | 'steer',
    images: readonly LocalPiImageContent[] = [],
  ) => {
    if (images.length === 0 && opensMcpSettings(text)) {
      setIntegrationsTab('mcp')
      setRail('integrations')
      return
    }
    await actions.send(text, action, images)
  }, [actions, setRail])

  const runPlanAction = React.useCallback(async (
    action: PlanActionId,
    revision?: string,
  ) => {
    if (!conversationReady || !extension.planMode?.actions.includes(action)) {
      throw new Error('The Plan Mode capability is no longer available.')
    }
    if (action === 'revise') {
      const feedback = revision?.trim()
      if (feedback) await actions.send(feedback, 'prompt')
      return
    }
    await actions.send(planActionRoute(action), 'prompt')
  }, [actions, conversationReady, extension.planMode])

  const runGoalAction = React.useCallback(async (action: GoalActionId) => {
    if (!conversationReady || !extension.goalMode?.actions.includes(action)) {
      throw new Error('The Goal capability is no longer available.')
    }
    await actions.send(goalActionRoute(action), 'prompt')
  }, [actions, conversationReady, extension.goalMode])

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex h-screen w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <ActivityRail
            rail={frameNav.rail}
            onRailChange={setRail}
            contextPanelOpen={frameNav.contextPanelOpen}
            onToggleContextPanel={toggleContextPanel}
            onOpenPalette={openPalette}
            onOpenAbout={() => {
              setRail('settings')
              setSettingsSection('about')
            }}
          />
          <ContextPanel rail={frameNav.rail} hidden={!frameNav.contextPanelOpen} width={contextPanelWidth}>
            <SessionsPanel
              hidden={frameNav.rail !== 'sessions'}
              renamingSelectionToken={renamingToken}
              deletingSelectionToken={deletingSelectionToken}
              isOpeningSessionRow={isOpeningSessionRow}
              onSelect={openConversation}
              onNewPrimary={newPrimarySession}
              onNewProjectless={() => {
                requestSwitch(() => workspace.newSession({ kind: 'projectless' }))
                setRail('sessions')
              }}
              onRenameStart={(item) => setRenamingToken(item.summary.selectionToken)}
              onRenameCommit={(item, nextTitle) => {
                const currentTitle = item.summary.name?.trim() || item.summary.preview.trim()
                if (nextTitle.trim() && nextTitle.trim() !== currentTitle) {
                  requestSwitch(() =>
                    workspace.renameSession(
                      item.summary.scope,
                      item.summary.selectionToken,
                      nextTitle,
                    ))
                }
                setRenamingToken(null)
              }}
              onDuplicate={(item) => {
                requestSwitch(() => workspace.duplicateSession(
                  item.summary.scope,
                  item.summary.selectionToken,
                ))
                setRail('sessions')
              }}
              onDelete={(item) => {
                if (deletingSelectionToken) return
                setDeletionError(null)
                setPendingDeletion(item)
              }}
              onActivateProject={(workspaceId) => {
                requestSwitch(() => workspace.openWorkspace(workspaceId))
                setRail('sessions')
              }}
              onStartProjectTask={(workspaceId) => {
                requestSwitch(() => workspace.newSession({
                  kind: 'project',
                  workspaceId,
                }))
                setRail('sessions')
              }}
              onChooseWorkspace={() => {
                requestSwitch(async () => {
                  await workspace.chooseWorkspace()
                })
                setRail('sessions')
              }}
              onPinWorkspace={(workspaceId, pinned) => {
                run(() => workspace.setWorkspacePinned(workspaceId, pinned))
              }}
            />
            {frameNav.rail === 'integrations' && (
              <ContextPanelNav
                ariaLabel={t('rail.integrations')}
                items={[
                  {
                    id: 'overview',
                    label: t('settings.integrations.tab.overview'),
                    icon: <TbLayoutDashboard />,
                  },
                  {
                    id: 'mcp',
                    label: t('settings.integrations.tab.mcp'),
                    icon: <TbServer />,
                  },
                ]}
                activeId={integrationsTab}
                onSelect={(id) => {
                  if (id === 'overview' || id === 'mcp') setIntegrationsTab(id)
                }}
              />
            )}
            {frameNav.rail === 'settings' && (
              <ContextPanelNav
                ariaLabel={t('rail.settings')}
                items={SETTINGS_SECTIONS.map((meta) => ({
                  id: meta.id,
                  label: t(meta.labelKey),
                  icon: <meta.icon />,
                }))}
                activeId={settingsSection}
                onSelect={(id) => {
                  if (isSettingsSectionId(id)) setSettingsSection(id)
                }}
              />
            )}
          </ContextPanel>

          {frameNav.contextPanelOpen && (
            <PanelResizeHandle
              width={contextPanelWidth}
              min={CONTEXT_PANEL_MIN}
              max={CONTEXT_PANEL_MAX}
              defaultWidth={CONTEXT_PANEL_DEFAULT}
              label={t('panel.resizeContext')}
              onChange={setContextPanelWidth}
              side="left"
            />
          )}

          <main
            hidden={frameNav.rail !== 'sessions'}
            className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden"
          >
            <ChatHeader
              title={title}
              sessionVisible={conversationReady}
              inspectorOpen={frameNav.inspectorOpen}
              branch={conversationReady ? workspace.workspace?.branch ?? '' : ''}
              stats={conversationReady ? pi.stats : null}
              onToggleInspector={toggleInspector}
              onCompact={() => run(() => actions.compact())}
            />
            <MessageList
              turns={transcript.turns}
              revision={transcript.revision}
              presentation={conversation}
              sessionKey={conversationSessionKey}
              jumpRequest={conversationJump}
              status={pi.status}
              onFork={actions.fork}
              onPlanAction={runPlanAction}
              selectedSubagentId={selectedSubagentCall?.id ?? null}
              subagentFocusRequest={subagentFocusRequest}
              onOpenSubagent={openSubagentExecution}
            />
            {conversationReady ? (
              <ActiveControlBar
                planMode={extension.planMode}
                goalMode={extension.goalMode}
                retryActivity={pi.retryActivity}
                working={extension.working}
                onPlanAction={runPlanAction}
                onGoalAction={runGoalAction}
                onStopRetry={actions.abortRetry}
              />
            ) : null}
            <Composer
              connected={conversationReady}
              loadingModels={conversation.status === 'loading'}
              modelError={conversationReady || conversation.status === 'error'
                ? pi.error
                : null}
              selectedModel={selectedModel}
              models={conversationReady ? pi.models : []}
              selectedThinkingLevel={conversationReady
                ? pi.session?.thinkingLevel ?? null
                : null}
              thinkingLevels={conversationReady ? pi.thinkingLevels : []}
              isStreaming={conversationReady && (pi.session?.isStreaming ?? false)}
              commands={conversationReady ? pi.commands : []}
              commandCatalogState={commandCatalogState}
              queue={conversationReady ? pi.queue : EMPTY_COMPOSER_QUEUE}
              draftReplacement={conversationReady ? extension.draftReplacement : null}
              scopeKey={workspace.activeScope.kind === 'project'
                ? `project:${workspace.activeScope.workspaceId}:${workspace.activeSessionId}:${pi.runtime?.generation ?? 'none'}`
                : `projectless:${workspace.activeSessionId}:${pi.runtime?.generation ?? 'none'}`}
              sendShortcut={settings.composer.sendShortcut}
              supportsImages={selectedModel?.input.includes('image') ?? false}
              onModelChange={actions.selectModel}
              onThinkingChange={actions.selectThinking}
              onSubmit={submitComposer}
              onStop={actions.abort}
              onSetQueueMode={actions.setQueueMode}
              onCompleteCommandArguments={conversationReady
                ? actions.completeCommandArguments
                : undefined}
              onSearchContext={workspace.activeScope.kind === 'project'
                ? workspace.searchWorkspacePaths
                : undefined}
            />
          </main>

          {frameNav.rail === 'integrations' && (
            <main
              className="scroll-slim min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background"
              aria-label={t('rail.integrations')}
            >
              <IntegrationsSettings tab={integrationsTab} onTab={setIntegrationsTab} />
            </main>
          )}

          {frameNav.rail === 'settings' && (
            <SettingsLayout
              section={settingsSection}
              integrationsTab={integrationsTab}
              onIntegrationsTab={setIntegrationsTab}
            />
          )}

          {frameNav.inspectorOpen && (
            <>
              <PanelResizeHandle
                width={inspectorWidth}
                min={INSPECTOR_MIN}
                max={INSPECTOR_MAX}
                defaultWidth={INSPECTOR_DEFAULT}
                label={t('panel.resizeInspector')}
                onChange={setInspectorWidth}
                side="right"
              />
              <InspectorPanel
                width={inspectorWidth}
                conversation={conversation}
                outline={conversationReady ? transcript.outline : []}
                outlineSessionKey={conversationSessionKey}
                onNavigateOutline={navigateConversationOutline}
                subagentCall={selectedSubagentCall}
                onCloseSubagent={closeSubagentExecution}
              />
            </>
          )}
        </div>
      </div>

      <CommandPalette
        open={frameNav.paletteOpen}
        onOpenChange={(open) => {
          setFrameNav((current) => ({ ...current, paletteOpen: open }))
        }}
        ctx={commandContext}
        sessions={paletteSessions}
      />
      <ExtensionUiDialog
        request={conversationReady ? extension.dialog?.request ?? null : null}
        busy={extension.dialogBusy}
        onRespond={actions.respondToExtension}
      />
      <AlertDialog
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open && !deletingSelectionToken) {
            setPendingDeletion(null)
            setDeletionError(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.session.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.session.deleteDescription', {
                name: pendingDeletion
                  ? pendingDeletion.summary.name?.trim() ||
                    pendingDeletion.summary.preview.trim() ||
                    t('sidebar.session.untitled')
                  : t('sidebar.session.untitled'),
              })}
              {pendingDeletion &&
                pendingDeletion.summary.sessionId === workspace.activeSessionId &&
                conversationScopeKey(pendingDeletion.summary.scope) ===
                  conversationScopeKey(workspace.activeScope) && (
                  <> {t('sidebar.session.deleteActiveDescription')}</>
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletionError && (
            <div className="space-y-1 text-sm text-destructive" role="alert">
              <p>{deletionError}</p>
              <p>{t('sidebar.session.deleteReselect')}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingSelectionToken)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                !pendingDeletion ||
                Boolean(deletingSelectionToken) ||
                Boolean(deletionError)
              }
              onClick={() => {
                if (!pendingDeletion || deletingSelectionToken || deletionError) return
                const target = pendingDeletion
                setDeletingSelectionToken(target.summary.selectionToken)
                setDeletionError(null)
                void workspace.deleteSession(
                  target.summary.scope,
                  target.summary.selectionToken,
                ).then(() => {
                  setPendingDeletion(null)
                }).catch((error) => {
                  setDeletionError(
                    errorMessage(error) ?? t('sidebar.session.deleteFailed'),
                  )
                }).finally(() => {
                  setDeletingSelectionToken(null)
                })
              }}
            >
              {deletingSelectionToken && (
                <TbLoader2 className="size-4 animate-spin" aria-hidden />
              )}
              {t(deletingSelectionToken
                ? 'sidebar.session.deleting'
                : 'sidebar.session.deleteConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(workspace.errorCode)}
        onOpenChange={(open) => {
          if (!open) workspace.clearError()
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.operationError.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {piExecutableUnavailable
                ? t('sidebar.operationError.piUnavailable')
                : workspace.errorMessage || t('sidebar.operationError.description', {
                    code: workspace.errorCode ?? 'UNKNOWN_ERROR',
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {piExecutableUnavailable ? (
              <>
                <AlertDialogCancel>{t('common.close')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    workspace.clearError()
                    setSettingsSection('general')
                    setRail('settings')
                  }}
                >
                  {t('sidebar.operationError.openPiSettings')}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction onClick={workspace.clearError}>
                {t('common.ok')}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
