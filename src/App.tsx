import * as React from 'react'
import { createPortal } from 'react-dom'
import { TbLoader2 } from 'react-icons/tb'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { ActivityRail } from '@/components/frame/ActivityRail'
import { ContextPanel } from '@/components/frame/ContextPanel'
import { SettingsNavigation } from '@/components/frame/SettingsNavigation'
import { useWorkbenchNavigation } from '@/components/frame/useWorkbenchNavigation'
import { useSessionOpening } from '@/components/frame/useSessionOpening'
import { CommandPalette } from '@/components/frame/CommandPalette'
import { SessionsPanel } from '@/components/frame/SessionsPanel'
import type { SidebarConversationItem } from '@/components/layout/SessionList'
import { ConversationHeader, ConversationTranscript } from '@/components/chat/ConversationTranscript'
import { ConversationWelcome } from '@/components/chat/ConversationWelcome'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import {
  type ConversationJumpRequest,
} from '@/components/chat/MessageList'
import {
  Composer,
  type ComposerCommandCatalogState,
  type ComposerMentionInsertionRequest,
  type ComposerQueueState,
} from '@/components/chat/Composer'
import { ExtensionUiDialog } from '@/components/chat/ExtensionUiDialog'
import { ActiveControlBar } from '@/components/chat/ExtensionSurfaces'
import {
  InspectorPanel,
  type InspectorPreviewState,
  type InspectorTab,
} from '@/components/inspector/InspectorPanel'
import { InspectorPortalHost } from '@/components/inspector/InspectorPortalHost'
import { PanelResizeHandle } from '@/components/layout/PanelResizeHandle'
import {
  SettingsLayout,
  type IntegrationsTabId,
} from '@/components/settings/SettingsLayout'
import {
  type CommandContext,
  type SessionCommandEntry,
} from '@/lib/commands'
import { useApplySettings } from '@/lib/theme'
import { useT } from '@/i18n'
import { useUpdateSettings } from '@/store/settings'
import {
  derivePiConversationPresentation,
  usePiExtensionUi,
  usePiRpcActions,
  usePiRuntime,
  usePiTranscriptLoading,
  usePiTranscriptToolCall,
} from '@/store/pi-rpc'
import {
  conversationScopeKey,
  useWorkspaceStore,
} from '@/store/workspace'
import { opensMcpSettings } from '@/renderer/mcp/mcp-command-routing'
import {
  CONTEXT_PANEL_DEFAULT_WIDTH,
  CONTEXT_PANEL_MAX_WIDTH,
  CONTEXT_PANEL_MIN_WIDTH,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from '@/renderer/layout-preferences'
import type { LocalPiImageContent } from '@/shared/local-pi'
import type { WorkspacePathSearchEntry } from '@/shared/workspace-content'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
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
import { projectComposerMentionCandidates } from '@/renderer/composer/composer-mentions'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import {
  isOfficialSessionOpeningRow,
  sameConversationScope,
} from '@/store/workspace-state'

const EMPTY_COMPOSER_QUEUE: ComposerQueueState = Object.freeze({
  pendingCount: 0,
  detailsKnown: false,
  steering: [],
  followUp: [],
  steeringItems: [],
  followUpItems: [],
  steeringMode: 'one-at-a-time',
  followUpMode: 'one-at-a-time',
})

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : null
}

export default function App() {
  const settings = useApplySettings()
  const { update: updateSettings } = useUpdateSettings()
  const t = useT()
  const workspace = useWorkspaceStore()
  const pi = usePiRuntime()
  const transcriptLoading = usePiTranscriptLoading()
  const actions = usePiRpcActions()
  const extension = usePiExtensionUi()

  const {
    frameNav, rail, settingsSection, conversationWorkspace, frameLayoutMode,
    compactConversation, panelLayout, setPanelLayout, compactSettingsDetailOpen,
    closeCompactSettingsDetail, compactInspectorOpen, setCompactInspectorOpen,
    compactInspectorReturnFocusRef, setRail, setSettingsSection, setPaletteOpen,
    openPalette, toggleContextPanel, toggleInspector,
  } = useWorkbenchNavigation()
  const [integrationsTab, setIntegrationsTab] = React.useState<IntegrationsTabId>('overview')
  const [renamingToken, setRenamingToken] = React.useState<string | null>(null)
  const {
    openingSession, switching, selectionRevision, abandonSessionOpening,
    requestSwitch, requestSessionOpening,
  } = useSessionOpening({ workspace, pi, transcriptLoading })
  const [inspectorTab, setInspectorTab] = React.useState<InspectorTab>('files')
  const [inspectorContainer] = React.useState(() => {
    const container = document.createElement('div')
    container.className = 'h-full min-h-0'
    return container
  })
  const [inspectorPreview, setInspectorPreview] =
    React.useState<InspectorPreviewState | null>(null)
  const [pendingDeletion, setPendingDeletion] = React.useState<
    SidebarConversationItem | null
  >(null)
  const [deletingSelectionToken, setDeletingSelectionToken] = React.useState<string | null>(
    null,
  )
  const [deletionError, setDeletionError] = React.useState<string | null>(null)
  const [pendingProjectRemoval, setPendingProjectRemoval] = React.useState<
    WorkspaceSummary | null
  >(null)
  const [removingProjectId, setRemovingProjectId] = React.useState<string | null>(null)
  const [projectRemovalError, setProjectRemovalError] = React.useState<string | null>(null)
  const [conversationJump, setConversationJump] = React.useState<
    ConversationJumpRequest | null
  >(null)
  const conversationJumpSequence = React.useRef(0)
  const [composerMentionInsertionRequest, setComposerMentionInsertionRequest] =
    React.useState<ComposerMentionInsertionRequest | null>(null)
  const composerMentionInsertionSequence = React.useRef(0)
  const [subagentSelection, setSubagentSelection] = React.useState<
    SubagentInspectorSelection | null
  >(null)
  const [subagentFocusRequest, setSubagentFocusRequest] = React.useState<
    SubagentInspectorFocusRequest | null
  >(null)
  const subagentSelectionSequence = React.useRef(0)
  const subagentFocusSequence = React.useRef(0)

  const run = React.useCallback((operation: () => Promise<void>) => {
    void operation().catch(() => undefined)
  }, [])

  const activeRuntimeSelectionToken = pi.runtime?.sessionStatuses?.find((status) =>
    status.selected &&
    sameConversationScope(status.scope, workspace.activeScope))?.selectionToken
  const active = workspace.sessions.find((session) => activeRuntimeSelectionToken
    ? session.selectionToken === activeRuntimeSelectionToken
    : session.id === workspace.activeSessionId)
  const conversation = derivePiConversationPresentation({
    activeScopeKey: conversationScopeKey(workspace.activeScope),
    activeSessionId: workspace.activeSessionId,
    activation: openingSession
      ? openingSession.error
        ? { status: 'error', error: openingSession.error }
        : { status: 'loading' }
      : switching ? { status: 'loading' } : null,
    runtime: pi.runtime,
    session: pi.session,
    hydration: pi.hydration,
    runtimeLoading: pi.loading,
    transcriptLoading,
  })
  const conversationReady = conversation.status === 'ready'
  const composerScopeKey = workspace.activeScope.kind === 'project'
    ? `project:${workspace.activeScope.workspaceId}:${workspace.activeSessionId}:${pi.runtime?.generation ?? 'none'}`
    : `projectless:${workspace.activeSessionId}:${pi.runtime?.generation ?? 'none'}`
  const conversationSessionKey = conversationReady
    ? `${conversationScopeKey(workspace.activeScope)}:${conversation.sessionId}:${pi.runtime?.generation ?? 'none'}`
    : null
  const operationOwnerKey = JSON.stringify([
    composerScopeKey,
    activeRuntimeSelectionToken ?? null,
    selectionRevision,
    conversationReady,
  ])
  const compactFeedback = useConversationOperationFeedback(operationOwnerKey)
  const paletteStopFeedback = useConversationOperationFeedback(operationOwnerKey)

  React.useEffect(() => {
    setInspectorPreview((current) => (
      current?.workspaceId === workspace.workspace?.id ? current : null
    ))
  }, [workspace.workspace?.id])
  const addWorkspaceReferenceToComposer = React.useCallback((
    entry: WorkspacePathSearchEntry,
  ) => {
    if (!conversationReady || workspace.activeScope.kind !== 'project') return
    const candidate = projectComposerMentionCandidates([entry], []).files[0]
    if (!candidate) return
    setRail('sessions')
    setComposerMentionInsertionRequest({
      candidate,
      scopeKey: composerScopeKey,
      sequence: ++composerMentionInsertionSequence.current,
    })
  }, [composerScopeKey, conversationReady, setRail, workspace.activeScope.kind])
  const selectedTool = usePiTranscriptToolCall(subagentSelection?.sessionKey === conversationSessionKey
    ? subagentSelection?.toolCallId ?? null : null)
  const selectedSubagentCall = selectedTool?.subagent ? selectedTool : null
  const compactInspectorVisible = compactInspectorOpen || Boolean(selectedSubagentCall)

  React.useEffect(() => {
    if (subagentSelection && !selectedSubagentCall) setSubagentSelection(null)
  }, [selectedSubagentCall, subagentSelection])

  React.useEffect(() => {
    if (!conversationWorkspace || !selectedSubagentCall) return
    if (compactConversation) {
      setCompactInspectorOpen((current) => {
        if (!current && !compactInspectorReturnFocusRef.current) {
          compactInspectorReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        }
        return true
      })
      return
    }
    setPanelLayout((current) => current.inspectorOpen
      ? current
      : { ...current, inspectorOpen: true })
  }, [compactConversation, conversationWorkspace, selectedSubagentCall])

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
    if (compactConversation) {
      compactInspectorReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      setCompactInspectorOpen(true)
    } else {
      setPanelLayout((current) => current.inspectorOpen
        ? current
        : { ...current, inspectorOpen: true })
    }
  }, [
    closeSubagentExecution,
    compactConversation,
    conversationSessionKey,
    subagentSelection,
  ])
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
    siblings: readonly SidebarConversationItem['summary'][],
  ) => isOfficialSessionOpeningRow(
    summary,
    siblings,
    openingSession && !openingSession.error
      ? {
          scope: openingSession.scope,
          selectionToken: openingSession.selectionToken,
          ...(openingSession.activation !== null &&
            pi.runtime?.generation === openingSession.activation.generation
            ? { sessionId: openingSession.activation.sessionId }
            : {}),
        }
      : null,
  ), [openingSession, pi.runtime?.generation])

  const openConversation = React.useCallback((item: SidebarConversationItem) => {
    requestSessionOpening(item)
  }, [requestSessionOpening])
  const openConversationFromPalette = React.useCallback((item: SidebarConversationItem) => {
    setRail('sessions')
    requestSessionOpening(item)
  }, [requestSessionOpening, setRail])

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
    },
    openIntegrationsTab: (tab) => {
      setIntegrationsTab(tab)
      setSettingsSection('integrations')
    },
    stopGeneration: () => {
      if (!conversationReady) return
      void paletteStopFeedback.run('stop', () => actions.abort(), t('composer.stopFailed'))
    },
    selectSession: openConversationFromPalette,
  }), [
    actions,
    conversationReady,
    newPrimarySession,
    openConversationFromPalette,
    paletteStopFeedback.run,
    pi.session?.isStreaming,
    setRail,
    setSettingsSection,
    toggleContextPanel,
    toggleInspector,
    t,
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
      setSettingsSection('integrations')
      return
    }
    await actions.send(text, action, images)
  }, [actions, setSettingsSection])

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

  const inspectorPanel = (
    <InspectorPanel
      width={panelLayout.inspectorWidth}
      visible={conversationWorkspace && (compactConversation
        ? compactInspectorVisible
        : panelLayout.inspectorOpen)}
      onClose={() => {
        if (compactConversation) setCompactInspectorOpen(false)
        else setPanelLayout((current) => ({ ...current, inspectorOpen: false }))
        if (selectedSubagentCall) closeSubagentExecution()
      }}
      activeTab={inspectorTab}
      onActiveTabChange={setInspectorTab}
      previewState={inspectorPreview}
      onPreviewStateChange={setInspectorPreview}
      conversation={conversation}
      sessionKey={conversationSessionKey}
      onAddWorkspaceReference={conversationReady && workspace.activeScope.kind === 'project'
        ? addWorkspaceReferenceToComposer
        : undefined}
      subagentCall={selectedSubagentCall}
      onCloseSubagent={closeSubagentExecution}
    />
  )
  const compactSettingsDetailVisible = frameLayoutMode === 'settings-compact' && compactSettingsDetailOpen
  const contextPanelVisible = frameNav.contextPanelOpen && !compactSettingsDetailVisible

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex h-screen w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <ActivityRail
            rail={rail}
            onRailChange={setRail}
            contextPanelOpen={contextPanelVisible}
            onToggleContextPanel={compactSettingsDetailVisible ? () => {
              closeCompactSettingsDetail()
              if (!frameNav.contextPanelOpen) toggleContextPanel()
            } : toggleContextPanel}
            onOpenPalette={openPalette}
            onOpenAbout={() => setSettingsSection('about')}
            width={panelLayout.contextPanelWidth}
          >
            <ContextPanel
              rail={rail}
              hidden={!contextPanelVisible}
              showHeader={false}
              className="min-h-0 w-full flex-1 border-r-0"
            >
              <SessionsPanel
                hidden={!conversationWorkspace}
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
                    run(() =>
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
                onRemoveWorkspace={(project) => {
                  if (removingProjectId) return
                  setProjectRemovalError(null)
                  setPendingProjectRemoval(project)
                }}
              />
              {frameNav.route.workspace === 'settings' && !compactSettingsDetailVisible && (
                <SettingsNavigation section={settingsSection} onSelect={setSettingsSection} />
              )}
            </ContextPanel>
          </ActivityRail>

          {contextPanelVisible && (
            <PanelResizeHandle
              width={panelLayout.contextPanelWidth}
              min={CONTEXT_PANEL_MIN_WIDTH}
              max={CONTEXT_PANEL_MAX_WIDTH}
              defaultWidth={CONTEXT_PANEL_DEFAULT_WIDTH}
              label={t('panel.resizeContext')}
              onChange={(contextPanelWidth) => {
                setPanelLayout((current) => ({ ...current, contextPanelWidth }))
              }}
              side="left"
            />
          )}

          <main
            hidden={!conversationWorkspace}
            className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden bg-surface"
          >
            <ConversationHeader
              title={title}
              ownerKey={conversationSessionKey}
              projectName={workspace.activeScope.kind === 'project' ? workspace.workspace?.name : undefined}
              status={conversationReady ? pi.status : undefined}
              onNavigate={navigateConversationOutline}
              onNewConversation={newPrimarySession}
              onShowChanges={() => {
                if (selectedSubagentCall) closeSubagentExecution()
                setInspectorTab('diff')
                if (compactConversation) setCompactInspectorOpen(true)
                else setPanelLayout((current) => ({ ...current, inspectorOpen: true }))
              }}
              sessionVisible={conversationReady}
              inspectorOpen={compactConversation
                ? compactInspectorOpen
                : panelLayout.inspectorOpen}
              branch={conversationReady ? workspace.workspace?.branch ?? '' : ''}
              stats={conversationReady ? pi.stats : null}
              onToggleInspector={toggleInspector}
              compacting={Boolean(compactFeedback.pending)}
              onCompact={() => {
                if (!conversationReady) return
                void compactFeedback.run('compact', () => actions.compact(), t('chat.compactionFailed'))
              }}
            />
            {compactFeedback.error ? (
              <div role="alert" data-conversation-action-error="compact" className="shrink-0 break-words px-4 py-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive">
                <MarkdownContent markdown={compactFeedback.error} />
              </div>
            ) : compactFeedback.pending ? (
              <p role="status" className="shrink-0 px-4 py-2 text-caption text-muted-foreground">
                {t('chat.compacting')}
              </p>
            ) : null}
            {paletteStopFeedback.error ? (
              <div role="alert" data-conversation-action-error="stop" className="shrink-0 break-words px-4 py-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive">
                <MarkdownContent markdown={paletteStopFeedback.error} />
              </div>
            ) : null}
            <ConversationTranscript
              emptyState={<ConversationWelcome
                selected={conversationReady}
                projectName={workspace.activeScope.kind === 'project' ? workspace.workspace?.name : undefined}
                onOpenProject={() => { requestSwitch(async () => { await workspace.chooseWorkspace() }); setRail('sessions') }}
              />}
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
              draftEditable={!switching && Boolean(workspace.activeSessionId)}
              loadingModels={conversation.status === 'loading'}
              availabilityError={conversationReady || conversation.status === 'error'
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
              mentionInsertionRequest={composerMentionInsertionRequest}
              scopeKey={composerScopeKey}
              draftKey={`${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId ?? 'unselected'}`}
              operationOwnerKey={operationOwnerKey}
              sendShortcut={settings.composer.sendShortcut}
              runningSubmitPreference={settings.composer.runningSubmit}
              supportsImages={selectedModel?.input.includes('image') ?? false}
              onModelChange={actions.selectModel}
              onThinkingChange={actions.selectThinking}
              onSubmit={submitComposer}
              onStop={actions.abort}
              onRunningSubmitPreferenceChange={(runningSubmit) => {
                updateSettings({ composer: { runningSubmit } })
              }}
              onSetQueueMode={actions.setQueueMode}
              onPromoteFollowUp={actions.promoteFollowUp}
              onRemoveQueuedMessage={actions.removeQueuedMessage}
              onCompleteCommandArguments={conversationReady
                ? actions.completeCommandArguments
                : undefined}
              onSearchContext={workspace.activeScope.kind === 'project'
                ? workspace.searchWorkspacePaths
                : undefined}
            />
          </main>

          {frameNav.settingsVisited && (
            <SettingsLayout
              hidden={conversationWorkspace}
              operationOwnerKey={operationOwnerKey}
              section={settingsSection}
              integrationsTab={integrationsTab}
              onIntegrationsTab={setIntegrationsTab}
              compact={frameLayoutMode === 'settings-compact'}
              detailVisible={frameLayoutMode !== 'settings-compact' || compactSettingsDetailOpen}
              onBack={frameLayoutMode === 'settings-compact' ? closeCompactSettingsDetail : undefined}
            />
          )}

          {conversationWorkspace && panelLayout.inspectorOpen && !compactConversation && (
            <>
              <PanelResizeHandle
                width={panelLayout.inspectorWidth}
                min={INSPECTOR_MIN_WIDTH}
                max={INSPECTOR_MAX_WIDTH}
                defaultWidth={INSPECTOR_DEFAULT_WIDTH}
                label={t('panel.resizeInspector')}
                onChange={(inspectorWidth) => {
                  setPanelLayout((current) => ({ ...current, inspectorWidth }))
                }}
                side="right"
              />
              <InspectorPortalHost container={inspectorContainer} />
            </>
          )}
        </div>
      </div>

      {compactConversation && conversationWorkspace && (
        <Dialog
          open={compactInspectorVisible}
          onOpenChange={(open) => {
            setCompactInspectorOpen(open)
            if (!open && selectedSubagentCall) closeSubagentExecution()
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="flex flex-col translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 bg-sidebar p-0"
            onInteractOutside={(event) => {
              // The retained portal has stable React ancestry but moves into this dialog's DOM.
              const target = event.detail.originalEvent.target
              if (target instanceof Node && inspectorContainer.contains(target)) event.preventDefault()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const returnTarget = compactInspectorReturnFocusRef.current
              compactInspectorReturnFocusRef.current = null
              returnTarget?.focus()
            }}
            style={{
              top: 0,
              right: 0,
              bottom: 0,
              left: 'auto',
              width: panelLayout.inspectorWidth,
              height: '100%',
              maxWidth: 'calc(100% - 48px)',
              transform: 'none',
            }}
          >
            <DialogTitle className="sr-only">{t('inspector.title')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('inspector.title')}
            </DialogDescription>
            <InspectorPortalHost container={inspectorContainer} />
          </DialogContent>
        </Dialog>
      )}

      {createPortal(inspectorPanel, inspectorContainer)}

      <CommandPalette
        open={frameNav.paletteOpen}
        onOpenChange={setPaletteOpen}
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
        open={Boolean(pendingProjectRemoval)}
        onOpenChange={(open) => {
          if (!open && !removingProjectId) {
            setPendingProjectRemoval(null)
            setProjectRemovalError(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.project.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.project.removeDescription', {
                name: pendingProjectRemoval?.name ?? '',
              })}
              {pendingProjectRemoval &&
                workspace.activeScope.kind === 'project' &&
                workspace.activeScope.workspaceId === pendingProjectRemoval.id && (
                  <> {t('sidebar.project.removeActiveDescription')}</>
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {projectRemovalError && (
            <div className="space-y-1 text-sm text-destructive" role="alert">
              <p>{projectRemovalError}</p>
              <p>{t('sidebar.project.removeRetry')}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(removingProjectId)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                !pendingProjectRemoval ||
                Boolean(removingProjectId) ||
                Boolean(projectRemovalError)
              }
              onClick={() => {
                if (!pendingProjectRemoval || removingProjectId || projectRemovalError) return
                const target = pendingProjectRemoval
                abandonSessionOpening()
                setRemovingProjectId(target.id)
                setProjectRemovalError(null)
                void workspace.removeWorkspace(target.id).then(() => {
                  setPendingProjectRemoval(null)
                }).catch((error) => {
                  setProjectRemovalError(
                    errorMessage(error) ?? t('sidebar.project.removeFailed'),
                  )
                }).finally(() => {
                  setRemovingProjectId(null)
                })
              }}
            >
              {removingProjectId && (
                <TbLoader2 className="size-4 animate-spin" aria-hidden />
              )}
              {t(removingProjectId
                ? 'sidebar.project.removing'
                : 'sidebar.project.removeConfirm')}
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
