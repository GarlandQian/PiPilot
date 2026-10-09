import * as React from 'react'
import { createPortal } from 'react-dom'
import { TbLoader2 } from 'react-icons/tb'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { useStartWriting } from '@/components/frame/useStartWriting'
import { useTaskNotificationNavigation } from '@/components/frame/useTaskNotificationNavigation'
import { ConversationNotices } from '@/components/chat/ConversationNotices'
import { ConversationSearchDialog } from '@/components/chat/ConversationSearchDialog'
import { ConversationExportDialog } from '@/components/chat/ConversationExportDialog'
import { ConversationImportDialog } from '@/components/chat/ConversationImportDialog'
import { ConversationContextPanel } from '@/components/inspector/ConversationContextPanel'
import { ConversationSummaryCard } from '@/components/inspector/ConversationSummaryCard'
import { CommitButton } from '@/components/inspector/CommitControls'
import { OpenInEditorButton } from '@/components/inspector/OpenInEditorButton'
import { APP_SHORTCUTS } from '@/lib/app-shortcuts'
import { isPrimaryModifier, matchesShortcut, type ShortcutSpec } from '@/lib/keyboard-shortcuts'
import { revealCurrentPlan } from '@/components/chat/plan-presentation'
import type { ConversationExportTarget } from '@/shared/conversation-export'
import { PrecisionReferencesProvider } from '@/components/precision/PrecisionReferences'
import type { ConversationScope, OfficialPiSessionSummary } from '@/shared/conversation-scope'
import type { ConversationImportCommitRequest } from '@/shared/conversation-import'
import type { ConversationSearchMatch } from '@/shared/conversation-search'
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
  type ComposerTextInsertionRequest,
  type ComposerQueueState,
} from '@/components/chat/Composer'
import { ExtensionUiDialog } from '@/components/chat/ExtensionUiDialog'
import { ActiveControlBar } from '@/components/chat/ExtensionSurfaces'
import { lastTurnEditedPaths } from '@/components/inspector/diff-scope'
import { requestModelsQuickAdd } from '@/renderer/models-intent'
import { InspectorPortalHost } from '@/components/inspector/InspectorPortalHost'
import { SideConversationsPanel, type SideQuestionRequest } from '@/components/inspector/SideConversationsPanel'
import type { PrecisionReference } from '@/renderer/composer/precision-reference'
import { panelDockOf, panelTab, type PanelDock } from '@/components/inspector/panel-tabs'
import { PanelTabContainers } from '@/components/inspector/PanelTabStrip'
import { BottomDock, RightDock } from '@/components/inspector/PanelDocks'
import { WorkspacePanelContents, type WorkspaceChangeTotals } from '@/components/inspector/WorkspacePanel'
import { TerminalTabContent, type TerminalCreateRequest } from '@/components/inspector/TerminalTab'
import { TerminalActionsContext } from '@/components/inspector/TerminalActions'
import { TerminalExternalAppMenu } from '@/components/inspector/TerminalExternalAppMenu'
import { SubagentExecutionPanel } from '@/components/inspector/SubagentExecutionPanel'
import { CommandExecutionPanel } from '@/components/inspector/CommandExecutionPanel'
import { usePanelStrip } from '@/components/inspector/panel-strip-tabs'
import { useConversationPanel } from '@/components/frame/useConversationPanel'
import { createDefaultWorkspaceAdapter } from '@/renderer/adapters/workspace-adapter'
import { PanelResizeHandle } from '@/components/layout/PanelResizeHandle'
import type { IntegrationsTabId } from '@/components/settings/SettingsLayout'
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
  usePiSessionEntries,
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
  isOfficialSessionActiveRow,
  isOfficialSessionOpeningRow,
  runtimeStateForOfficialSession,
  sameConversationScope,
} from '@/store/workspace-state'
import { sidebarConversationTitle } from '@/components/layout/session-navigation'

const SettingsLayout = React.lazy(() => import('@/components/settings/SettingsLayout').then((module) => ({ default: module.SettingsLayout })))

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

const UNSELECTED_SESSION = 'unselected'
/** `scope:unselected` became `scope:<session>`: the same conversation, now with its session. */
function conversationGainedSession(previous: string, next: string) {
  const suffix = `:${UNSELECTED_SESSION}`
  return previous.endsWith(suffix) && !next.endsWith(suffix) && next.startsWith(previous.slice(0, -UNSELECTED_SESSION.length))
}

export default function App() {
  const settings = useApplySettings()
  const { update: updateSettings } = useUpdateSettings()
  const t = useT()
  const workspace = useWorkspaceStore()
  const pi = usePiRuntime()
  const transcriptLoading = usePiTranscriptLoading()
  // Durable entries only: streaming deltas do not recompute this.
  const sessionEntries = usePiSessionEntries()
  const lastTurnPaths = React.useMemo(() => sessionEntries ? lastTurnEditedPaths(sessionEntries.entries, sessionEntries.leafId) : [], [sessionEntries])
  const actions = usePiRpcActions()
  const extension = usePiExtensionUi()

  const {
    frameNav, rail, settingsSection, conversationWorkspace, frameLayoutMode,
    compactConversation, panelLayout, setPanelLayout, compactSettingsDetailOpen,
    closeCompactSettingsDetail, compactInspectorOpen, setCompactInspectorOpen,
    compactInspectorReturnFocusRef, setRail, setSettingsSection, setPaletteOpen,
    toggleContextPanel,
  } = useWorkbenchNavigation()
  const [integrationsTab, setIntegrationsTab] = React.useState<IntegrationsTabId>('overview')
  const [searchScope, setSearchScope] = React.useState<'current' | 'all'>('current')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [exportTarget, setExportTarget] = React.useState<ConversationExportTarget | null>(null)
  const [exportName, setExportName] = React.useState('')
  const [importScope, setImportScope] = React.useState<ConversationScope | null>(null)
  const [composerTextInsertionRequest, setComposerTextInsertionRequest] = React.useState<ComposerTextInsertionRequest | null>(null)
  const composerTextInsertionSequence = React.useRef(0)
  const [sideQuestion, setSideQuestion] = React.useState<SideQuestionRequest | null>(null)
  const [pendingSearchJump, setPendingSearchJump] = React.useState<{ session: OfficialPiSessionSummary; entryId: string; query: string; match: ConversationSearchMatch; selectionRevision: number } | null>(null)
  const [renamingToken, setRenamingToken] = React.useState<string | null>(null)
  const {
    openingSession, switching, selectionRevision, abandonSessionOpening,
    requestSwitch, requestSessionOpening,
  } = useSessionOpening({ workspace, pi, transcriptLoading })
  // Full screen hides macOS's window buttons; the chrome drops their inset.
  const [windowFullScreen, setWindowFullScreen] = React.useState(false)
  React.useEffect(() => {
    const api = window.pipilot
    if (!api) return
    const apply = (state: { fullScreen: boolean }) => {
      setWindowFullScreen(state.fullScreen)
      document.documentElement.dataset.fullscreen = String(state.fullScreen)
    }
    void api.window.getState().then(apply).catch(() => undefined)
    return api.window.subscribe(apply)
  }, [])
  // Codex workspace tabs: each conversation keeps its own, in the right or bottom dock.
  // An empty session id is no session yet, like none at all.
  const conversationTabsKey = `${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId || UNSELECTED_SESSION}`
  // Opening the narrow-window overlay remembers what had focus, so closing it can return there.
  const setCompactPanelOpen = React.useCallback((open: boolean) => {
    if (open && !compactInspectorReturnFocusRef.current && document.activeElement instanceof HTMLElement && !document.activeElement.closest('[role="dialog"]')) {
      compactInspectorReturnFocusRef.current = document.activeElement
    }
    setCompactInspectorOpen(open)
  }, [compactInspectorReturnFocusRef, setCompactInspectorOpen])
  const panel = useConversationPanel({
    conversationKey: conversationTabsKey,
    compact: compactConversation,
    compactOpen: compactInspectorOpen,
    setCompactOpen: setCompactPanelOpen,
    inherits: conversationGainedSession,
  })
  const [panelContainers] = React.useState(() => new PanelTabContainers())
  const [workspaceAdapter] = React.useState(createDefaultWorkspaceAdapter)
  const [changeTotals, setChangeTotals] = React.useState<WorkspaceChangeTotals | null>(null)
  // Settings › Terminal › Default location: where a new terminal tab opens.
  const terminalDock: PanelDock = settings.terminal.location === 'panel' ? 'right' : 'bottom'
  const terminalVisible = panel.isVisible('terminal')
  // Terminals stay mounted once opened, across conversations: a live PTY is not a snapshot.
  const [terminalMounted, setTerminalMounted] = React.useState(false)
  React.useEffect(() => { if (panel.state.tabs.terminal) setTerminalMounted(true) }, [panel.state.tabs.terminal])
  // The conversation summary floats over the window's trailing edge (Codex).
  const [summaryOpen, setSummaryOpen] = React.useState(false)
  // A commit changes what the review and the toolbar count; refresh them at once.
  const [commitRevision, setCommitRevision] = React.useState(0)
  // ⌃`: show the terminal, or put away the dock that shows it.
  const toggleTerminal = React.useCallback(() => {
    if (panel.isVisible('terminal')) {
      if (panelDockOf(panel.state, 'terminal') === 'bottom') panel.setBottom(false)
      else panel.hideRight()
      return
    }
    panel.open(panelTab('terminal'), { dock: terminalDock })
  }, [panel, terminalDock])
  const [rightDockContainer] = React.useState(() => {
    const container = document.createElement('div')
    container.className = 'h-full min-h-0'
    return container
  })
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
  const subagentSelectionSequence = React.useRef(0)
  const subagentReturnFocus = React.useRef<HTMLElement | null>(null)
  const [commandSelection, setCommandSelection] = React.useState<{ sessionKey: string; toolCallId: string } | null>(null)
  const commandReturnFocus = React.useRef<HTMLElement | null>(null)

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
  const { startWriting, cancelStartWriting, starting, focusRequest } = useStartWriting({
    workspace, ready: conversationReady, failed: conversation.status === 'error',
    generation: pi.runtime?.generation, composerScopeKey, selectionRevision, requestSwitch,
  })
  const deletionSiblings = pendingDeletion
    ? workspace.sessionCatalogs[conversationScopeKey(pendingDeletion.summary.scope)]?.rows ?? []
    : []
  const deletionSummary = pendingDeletion
    ? deletionSiblings.find((row) => row.selectionToken === pendingDeletion.summary.selectionToken) ?? pendingDeletion.summary
    : null
  const deletingCurrentSession = Boolean(deletionSummary && isOfficialSessionActiveRow(
    deletionSummary, deletionSiblings, workspace.activeScope, workspace.activeSessionId,
    runtimeStateForOfficialSession(deletionSummary, pi.runtime?.sessionStatuses, deletionSiblings)?.selected,
  ))
  const operationOwnerKey = JSON.stringify([
    composerScopeKey,
    activeRuntimeSelectionToken ?? null,
    selectionRevision,
    conversationReady,
  ])
  const compactFeedback = useConversationOperationFeedback(operationOwnerKey)
  const paletteStopFeedback = useConversationOperationFeedback(operationOwnerKey)
  React.useEffect(() => { setExportTarget((current) => current && 'selectionToken' in current ? current : null) }, [operationOwnerKey])

  const exportConversation = React.useCallback((selection: ConversationExportTarget['selection'] = { kind: 'conversation' }) => {
    if (!conversationReady || !conversation.sessionId || !pi.runtime) return
    setExportName(pi.session?.sessionName ?? '')
    setExportTarget({ scope: workspace.activeScope, generation: pi.runtime.generation, sessionId: conversation.sessionId, selection })
  }, [conversationReady, conversation, pi.runtime, pi.session?.sessionName, workspace.activeScope])
  const exportCatalogConversation = React.useCallback((item: SidebarConversationItem) => {
    setExportName(sidebarConversationTitle(item.summary, t('sidebar.session.untitled')))
    setExportTarget({ scope: item.summary.scope, selectionToken: item.summary.selectionToken, selection: { kind: 'conversation' } })
  }, [t])
  const commitImportedConversation = React.useCallback((input: ConversationImportCommitRequest) => new Promise<void>((resolve, reject) => {
    setRail('sessions')
    requestSwitch(async () => {
      try { await workspace.importSession(input); resolve() }
      catch (error) { reject(error) }
    })
  }), [requestSwitch, setRail, workspace])
  const suggestNextAction = React.useCallback((text: string) => {
    if (!conversationReady) return
    panel.revealConversation()
    setComposerTextInsertionRequest({ text, scopeKey: composerScopeKey, sequence: ++composerTextInsertionSequence.current })
  }, [conversationReady, composerScopeKey, panel])
  const addWorkspaceReferenceToComposer = React.useCallback((
    entry: WorkspacePathSearchEntry,
  ) => {
    if (!conversationReady || workspace.activeScope.kind !== 'project') return
    const candidate = projectComposerMentionCandidates([entry], []).files[0]
    if (!candidate) return
    panel.revealConversation()
    setRail('sessions')
    setComposerMentionInsertionRequest({
      candidate,
      scopeKey: composerScopeKey,
      sequence: ++composerMentionInsertionSequence.current,
    })
  }, [composerScopeKey, conversationReady, panel, setRail, workspace.activeScope.kind])
  const selectedTool = usePiTranscriptToolCall(subagentSelection?.sessionKey === conversationSessionKey
    ? subagentSelection?.toolCallId ?? null : null)
  const selectedSubagentCall = selectedTool?.subagent ? selectedTool : null
  const commandTool = usePiTranscriptToolCall(commandSelection?.sessionKey === conversationSessionKey
    ? commandSelection.toolCallId : null)
  const selectedCommandCall = commandTool?.kind === 'shell' ? commandTool : null
  const compactInspectorVisible = compactInspectorOpen

  // An agent's or a command's tab closes with the record it shows.
  React.useEffect(() => {
    if (commandSelection && !selectedCommandCall) setCommandSelection(null)
    if (!selectedCommandCall && panel.state.tabs.command) panel.close('command')
  }, [commandSelection, panel, selectedCommandCall])

  React.useEffect(() => {
    if (subagentSelection && !selectedSubagentCall) setSubagentSelection(null)
    if (!selectedSubagentCall && panel.state.tabs.subagent) panel.close('subagent')
  }, [panel, selectedSubagentCall, subagentSelection])

  React.useEffect(() => {
    setConversationJump(null)
  }, [conversationSessionKey])
  const navigateConversationOutline = React.useCallback((entryId: string) => {
    if (!conversationSessionKey) return
    setConversationJump({
      sessionKey: conversationSessionKey,
      entryId,
      sequence: ++conversationJumpSequence.current,
    })
  }, [conversationSessionKey])
  const navigateContextRecord = React.useCallback((entryId: string) => {
    setSummaryOpen(false)
    panel.revealConversation()
    navigateConversationOutline(entryId)
  }, [navigateConversationOutline, panel])
  const revealPlanFromOverview = React.useCallback(() => {
    setSummaryOpen(false)
    panel.revealConversation()
    // Let a collapsing overlay get out of the way before scrolling.
    requestAnimationFrame(revealCurrentPlan)
  }, [panel])
  const navigateSearch = React.useCallback((entryId: string, query: string, match: ConversationSearchMatch) => {
    if (!conversationSessionKey) return
    setConversationJump({ sessionKey: conversationSessionKey, entryId, query, match, sequence: ++conversationJumpSequence.current })
  }, [conversationSessionKey])
  const askSideQuestion = React.useCallback((reference: PrecisionReference) => {
    if (!conversationReady || !workspace.activeSessionId || reference.ownerKey !== `${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId}`) return
    setSideQuestion({ id: crypto.randomUUID(), scope: workspace.activeScope, parentSessionId: workspace.activeSessionId, reference })
    panel.revealConversation()
    panel.open(panelTab('sidechat'))
  }, [conversationReady, workspace.activeSessionId, workspace.activeScope, panel])
  const openSearchResult = React.useCallback((session: OfficialPiSessionSummary, entryId: string, query: string, match: ConversationSearchMatch) => {
    setRail('sessions')
    panel.revealConversation()
    if (conversationReady && sameConversationScope(session.scope, workspace.activeScope) && activeRuntimeSelectionToken === session.selectionToken) {
      setPendingSearchJump(null)
      navigateSearch(entryId, query, match)
      return
    }
    setPendingSearchJump({ session, entryId, query, match, selectionRevision: selectionRevision + 1 })
    requestSessionOpening({ summary: session })
  }, [activeRuntimeSelectionToken, conversationReady, navigateSearch, panel, requestSessionOpening, setRail, workspace.activeScope, selectionRevision])
  React.useEffect(() => {
    if (pendingSearchJump && selectionRevision !== pendingSearchJump.selectionRevision) { setPendingSearchJump(null); return }
    if (!pendingSearchJump || !conversationReady || !conversationSessionKey) return
    if (activeRuntimeSelectionToken !== pendingSearchJump.session.selectionToken || !sameConversationScope(workspace.activeScope, pendingSearchJump.session.scope)) return
    navigateSearch(pendingSearchJump.entryId, pendingSearchJump.query, pendingSearchJump.match)
    setPendingSearchJump(null)
  }, [pendingSearchJump, conversationReady, conversationSessionKey, activeRuntimeSelectionToken, workspace.activeScope, navigateSearch, selectionRevision])
  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // ⌘F finds in this conversation; ⌘⌥F searches every conversation (⌘⇧F is full view).
      if (event.defaultPrevented || event.isComposing || !conversationWorkspace || !isPrimaryModifier(event) || event.shiftKey) return
      const all = event.altKey && event.code === 'KeyF'
      if (!all && (event.altKey || event.key.toLowerCase() !== 'f')) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"],[role="alertdialog"],.xterm')) return
      event.preventDefault()
      setSearchScope(all ? 'all' : 'current')
      setSearchOpen(true)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [conversationWorkspace])
  /** After a tab closes, focus the tab now selected, else whatever opened it. */
  const focusSelectedTab = React.useCallback((fallback: React.RefObject<HTMLElement | null>) => {
    requestAnimationFrame(() => {
      const tab = document.querySelector<HTMLElement>('[data-panel-strip] [role="tab"][aria-selected="true"]')
      if (tab?.checkVisibility()) tab.focus()
      else if (fallback.current?.isConnected) fallback.current.focus()
    })
  }, [])
  const closeSubagentExecution = React.useCallback(() => {
    setSubagentSelection(null)
    panel.close('subagent')
    focusSelectedTab(subagentReturnFocus)
  }, [focusSelectedTab, panel])
  const openSubagentExecution = React.useCallback((toolCallId: string) => {
    if (!conversationSessionKey) return
    // Clicking the agent that is already showing closes its tab again.
    if (subagentSelection?.sessionKey === conversationSessionKey && subagentSelection.toolCallId === toolCallId && panel.isVisible('subagent')) {
      closeSubagentExecution()
      return
    }
    subagentReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (compactConversation) compactInspectorReturnFocusRef.current = subagentReturnFocus.current
    setSubagentSelection({
      sessionKey: conversationSessionKey,
      toolCallId,
      sequence: ++subagentSelectionSequence.current,
    })
    panel.open(panelTab('subagent'))
  }, [closeSubagentExecution, compactConversation, compactInspectorReturnFocusRef, conversationSessionKey, panel, subagentSelection])
  const openCommandExecution = React.useCallback((toolCallId: string) => {
    if (!conversationSessionKey) return
    commandReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (compactConversation) compactInspectorReturnFocusRef.current = commandReturnFocus.current
    setCommandSelection({ sessionKey: conversationSessionKey, toolCallId })
    panel.open(panelTab('command'))
  }, [compactConversation, compactInspectorReturnFocusRef, conversationSessionKey, panel])
  const closeCommandExecution = React.useCallback(() => {
    setCommandSelection(null)
    panel.close('command')
    focusSelectedTab(commandReturnFocus)
  }, [focusSelectedTab, panel])
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
  const commitModel = React.useMemo(() => selectedModel ? { providerId: selectedModel.provider, modelId: selectedModel.id } : null, [selectedModel])
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
    setPendingSearchJump(null)
    requestSessionOpening(item)
  }, [requestSessionOpening])
  const openConversationFromPalette = React.useCallback((item: SidebarConversationItem) => {
    setPendingSearchJump(null)
    setRail('sessions')
    requestSessionOpening(item)
  }, [requestSessionOpening, setRail])
  const openNotificationSession = React.useCallback((summary: SidebarConversationItem['summary']) => {
    setRail('sessions')
    requestSessionOpening({ summary })
  }, [requestSessionOpening, setRail])
  const { openNotification, nativeOpenFailed, dismissNativeError } = useTaskNotificationNavigation({
    scope: workspace.activeScope,
    sessionId: conversationReady ? conversation.sessionId : null,
    visible: conversationWorkspace && conversationReady && !compactInspectorVisible && !panel.full,
    selectionRevision,
    route: rail,
    openSession: openNotificationSession,
  })

  const newPrimarySession = React.useCallback(() => {
    requestSwitch(() => workspace.newSession(workspace.activeScope))
    setRail('sessions')
  }, [requestSwitch, setRail, workspace])

  const newProjectlessSession = React.useCallback(() => {
    requestSwitch(() => workspace.newSession({ kind: 'projectless' }))
    setRail('sessions')
  }, [requestSwitch, setRail, workspace])
  const importIntoActiveScope = React.useCallback(() => {
    const project = workspace.activeScope.kind === 'project'
      ? workspace.recentProjects.find((candidate) => workspace.activeScope.kind === 'project' && candidate.id === workspace.activeScope.workspaceId)
      : undefined
    setImportScope(project?.available ? workspace.activeScope : { kind: 'projectless' })
  }, [workspace.activeScope, workspace.recentProjects])

  const projectAvailable = workspace.activeScope.kind === 'project' && workspace.workspace?.available === true
  /** Closing a tab also lets go of what it showed. */
  const closePanelTab = React.useCallback((id: string) => {
    if (id === 'subagent') setSubagentSelection(null)
    if (id === 'command') setCommandSelection(null)
    if (id === 'sidechat') setSideQuestion(null)
    panel.close(id)
  }, [panel])
  const closePanelTabs = React.useCallback((keep: string) => {
    const dock = panelDockOf(panel.state, keep)
    for (const id of dock ? panel.state[dock].tabIds : []) if (id !== keep) closePanelTab(id)
  }, [closePanelTab, panel])
  const openReview = React.useCallback(() => {
    if (projectAvailable) panel.open(panelTab('review'))
  }, [panel, projectAvailable])
  const openFile = React.useCallback((path: string) => {
    if (projectAvailable) panel.open(panelTab('file', path))
  }, [panel, projectAvailable])
  /** ⌘P: the files tab with its search field ready. */
  const searchFiles = React.useCallback(() => {
    if (!projectAvailable) return
    panel.open(panelTab('files'))
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-panel-view="files"] input[type="search"]')?.focus())
  }, [panel, projectAvailable])
  /** ⇧⌘E: show the file tree, or put it away when it is what shows. */
  const toggleFileTree = React.useCallback(() => {
    if (!projectAvailable) return
    if (panel.isVisible('files')) closePanelTab('files')
    else panel.open(panelTab('files'))
  }, [closePanelTab, panel, projectAvailable])
  const openSideChat = React.useCallback(() => {
    if (conversationReady) panel.open(panelTab('sidechat'))
  }, [conversationReady, panel])
  /** ⌘W: the tab in front (in the dock that has focus), else the window. */
  const closeFrontTab = React.useCallback(() => {
    const focusInBottom = document.activeElement?.closest('[data-panel-dock="bottom"]')
    const dock = focusInBottom && panel.bottomVisible ? 'bottom'
      : panel.rightVisible && panel.state.right.activeId ? 'right'
        : panel.bottomVisible ? 'bottom' : null
    const id = dock ? panel.state[dock].activeId : null
    if (conversationWorkspace && id) {
      closePanelTab(id)
      focusSelectedTab({ current: null })
      return
    }
    void window.pipilot?.window.close().catch(() => undefined)
  }, [closePanelTab, conversationWorkspace, focusSelectedTab, panel])

  // Codex's workspace shortcuts (⌘ on macOS, Ctrl on Windows and Linux).
  const shortcutActions = React.useRef<Array<[ShortcutSpec, () => void]>>([])
  shortcutActions.current = [
    [APP_SHORTCUTS.toggleBottomPanel, () => {
      if (panel.state.bottom.tabIds.length) { if (panel.full) panel.revealConversation(); panel.setBottom(!panel.bottomVisible) }
      else panel.open(panelTab('terminal'), { dock: 'bottom' })
    }],
    [APP_SHORTCUTS.toggleTerminal, toggleTerminal],
    [APP_SHORTCUTS.cycleLayout, panel.cycleLayout],
    [APP_SHORTCUTS.toggleFullView, panel.toggleFull],
    [APP_SHORTCUTS.switchChatAndTabs, panel.toggleTabs],
    [APP_SHORTCUTS.nextTab, () => panel.cycleTab(document.activeElement?.closest('[data-panel-dock="bottom"]') ? 'bottom' : 'right', 1)],
    [APP_SHORTCUTS.previousTab, () => panel.cycleTab(document.activeElement?.closest('[data-panel-dock="bottom"]') ? 'bottom' : 'right', -1)],
    [APP_SHORTCUTS.openReview, openReview],
    [APP_SHORTCUTS.searchFiles, searchFiles],
    [APP_SHORTCUTS.toggleFileTree, toggleFileTree],
    [APP_SHORTCUTS.openSideChat, openSideChat],
  ]
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !conversationWorkspace) return
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) return
      const match = shortcutActions.current.find(([spec]) => matchesShortcut(event, spec))
      if (!match) return
      // The terminal keeps its own ⌃Tab; everything else applies there too.
      if (match[0] === APP_SHORTCUTS.nextTab || match[0] === APP_SHORTCUTS.previousTab) {
        if (event.target instanceof Element && event.target.closest('.xterm')) return
      }
      event.preventDefault()
      match[1]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [conversationWorkspace])

  // Application-menu items (File › New Task / New Chat / Import… / Close Tab, PiPilot › Settings…).
  const menuCommands = React.useRef({ newPrimarySession, newProjectlessSession, importIntoActiveScope, setRail, closeFrontTab })
  menuCommands.current = { newPrimarySession, newProjectlessSession, importIntoActiveScope, setRail, closeFrontTab }
  React.useEffect(() => window.pipilot?.app.subscribeCommands((command) => {
    if (command === 'new-task') menuCommands.current.newPrimarySession()
    else if (command === 'new-chat') menuCommands.current.newProjectlessSession()
    else if (command === 'import-conversation') menuCommands.current.importIntoActiveScope()
    else if (command === 'open-settings') menuCommands.current.setRail('settings')
    else if (command === 'close-tab') menuCommands.current.closeFrontTab()
  }), [])

  const commandContext = React.useMemo<CommandContext>(() => ({
    generating: conversationReady && (pi.session?.isStreaming ?? false),
    setRail,
    toggleContextPanel,
    toggleInspector: panel.toggleTabs,
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
    projectOpen: projectAvailable,
    toggleBottomPanel: () => shortcutActions.current.find(([spec]) => spec === APP_SHORTCUTS.toggleBottomPanel)?.[1](),
    toggleTerminal,
    openReview,
    searchFiles,
    toggleFileTree,
    cycleLayout: panel.cycleLayout,
    toggleFullView: panel.toggleFull,
    toggleSummary: () => setSummaryOpen((open) => !open),
  }), [
    openReview,
    panel.cycleLayout,
    panel.toggleFull,
    projectAvailable,
    searchFiles,
    toggleFileTree,
    toggleTerminal,
    actions,
    conversationReady,
    newPrimarySession,
    openConversationFromPalette,
    paletteStopFeedback.run,
    pi.session?.isStreaming,
    setRail,
    setSettingsSection,
    toggleContextPanel,
    panel.toggleTabs,
    t,
  ])

  const paletteSessions = React.useMemo<SessionCommandEntry[]>(() => {
    const entries: SessionCommandEntry[] = []
    for (const catalog of Object.values(workspace.sessionCatalogs)) {
      for (const summary of catalog.rows) {
        const scope = summary.scope
        entries.push({
          item: { summary },
          title: sidebarConversationTitle(summary, t('sidebar.session.untitled')),
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
    submissionId?: string,
  ) => {
    if (images.length === 0 && opensMcpSettings(text)) {
      setIntegrationsTab('mcp')
      setSettingsSection('integrations')
      return
    }
    await actions.send(text, action, images, submissionId)
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

  // Terminals draw their tabs in the strip of the dock that holds them, and their tools in its header.
  const [terminalTabsHost, setTerminalTabsHost] = React.useState<HTMLDivElement | null>(null)
  const [rightTools, setRightTools] = React.useState<HTMLDivElement | null>(null)
  const [bottomTools, setBottomTools] = React.useState<HTMLDivElement | null>(null)
  const [newTerminalRequest, setNewTerminalRequest] = React.useState(0)
  const [terminalCreateRequest, setTerminalCreateRequest] = React.useState<TerminalCreateRequest>()
  const [pendingTerminalOpen, setPendingTerminalOpen] = React.useState<TerminalCreateRequest>()
  const terminalRequestSequence = React.useRef(0)
  const externalRequestSequence = React.useRef(0)
  const [externalOpenError, setExternalOpenError] = React.useState<{ scope: ConversationScope; relativeDirectory?: string; appId?: string; label?: string; code?: string } | null>(null)
  const openTerminalHere = React.useCallback((scope: ConversationScope, relativeDirectory?: string) => {
    setPendingTerminalOpen({ id: ++terminalRequestSequence.current, scope, relativeDirectory })
    if (!sameConversationScope(scope, workspace.activeScope) && scope.kind === 'project') {
      requestSwitch(() => workspace.openWorkspace(scope.workspaceId))
    }
    setRail('sessions')
  }, [requestSwitch, setRail, workspace])
  React.useEffect(() => {
    if (!pendingTerminalOpen || switching) return
    setPendingTerminalOpen(undefined)
    if (!sameConversationScope(pendingTerminalOpen.scope, workspace.activeScope)) return
    setTerminalCreateRequest(pendingTerminalOpen)
    panel.open(panelTab('terminal'), { dock: terminalDock })
  }, [pendingTerminalOpen, switching, workspace.activeScope, panel, terminalDock])
  const openExternalHere = React.useCallback((scope: ConversationScope, relativeDirectory?: string, appId?: string, appName?: string) => {
    const request = ++externalRequestSequence.current
    setExternalOpenError(null)
    void (async () => {
      const api = window.pipilot?.terminal
      if (!api) throw new Error('Terminal API unavailable')
      await api.openExternal(scope, appId, relativeDirectory)
    })().catch((error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
      if (externalRequestSequence.current === request) setExternalOpenError({
        scope, relativeDirectory, appId, code,
        label: appName ?? (settings.terminal.defaultExternalAppId ? settings.terminal.defaultExternalAppSnapshot?.label : undefined),
      })
    })
  }, [settings.terminal.defaultExternalAppId, settings.terminal.defaultExternalAppSnapshot?.label])
  const terminalHostDock = panelDockOf(panel.state, 'terminal')
  // Both docks share the strip's labels and the "+" menu.
  const strip = usePanelStrip({
    terminalSlot: setTerminalTabsHost,
    state: panel.state,
    projectAvailable,
    onOpenReview: openReview,
    onSearchFiles: searchFiles,
    onOpenFiles: () => panel.open(panelTab('files')),
    // With terminals open, "+ Terminal" adds another one (Codex).
    onOpenTerminal: () => {
      if (panel.state.tabs.terminal) setNewTerminalRequest((value) => value + 1)
      panel.open(panelTab('terminal'), { dock: terminalDock })
    },
  })
  const dockStrip = (dock: PanelDock) => ({
    tabs: strip.tabs(dock),
    activeId: panel.state[dock].activeId,
    onSelect: panel.select,
    onClose: closePanelTab,
    onCloseOthers: closePanelTabs,
    onMove: panel.move,
    onDropTab: (id: string, index: number) => panel.drop(id, dock, index),
    newTabItems: strip.newTabItems,
    tools: <div ref={dock === 'right' ? setRightTools : setBottomTools} className="flex shrink-0 items-center empty:hidden" data-dock-tools={dock} />,
  })
  const rightDock = <RightDock
    width={panel.full ? '100%' : panelLayout.inspectorWidth}
    full={panel.full}
    containers={panelContainers}
    tabIds={panel.state.right.tabIds}
    onToggleFull={compactConversation ? undefined : panel.toggleFull}
    onHide={panel.hideRight}
    {...dockStrip('right')}
  />
  const workspaceTabs = Object.values(panel.state.tabs)
  const fileTabs = workspaceTabs.flatMap((tab) => tab.kind === 'file' ? [tab.path] : [])
  const visibleFile = fileTabs.find((path) => panel.isVisible(`file:${path}`)) ?? null
  const panelWorkspace = workspace.activeScope.kind === 'project' && workspace.workspace?.id === workspace.activeScope.workspaceId && workspace.workspace.available
    ? workspace.workspace : null
  // A restored conversation drops tabs for files deleted since (Codex reopens them otherwise).
  const tabsKeyRef = React.useRef(conversationTabsKey)
  tabsKeyRef.current = conversationTabsKey
  const checkedFileTabs = React.useRef<string | null>(null)
  const fileTabKey = fileTabs.join('\u0000')
  React.useEffect(() => {
    if (!panelWorkspace || !workspaceAdapter) return
    const key = `${conversationTabsKey}\u0000${panelWorkspace.id}`
    if (checkedFileTabs.current === key) return
    checkedFileTabs.current = key
    const paths = fileTabKey ? fileTabKey.split('\u0000') : []
    if (!paths.length) return
    void workspaceAdapter.files.exist(panelWorkspace.id, paths.slice(0, 64)).then((result) => {
      if (tabsKeyRef.current !== conversationTabsKey || result.workspaceId !== panelWorkspace.id) return
      const existing = new Set(result.paths)
      panel.retain((tab) => tab.kind !== 'file' || existing.has(tab.path) || !paths.includes(tab.path))
    }, () => undefined)
  }, [conversationTabsKey, fileTabKey, panel, panelWorkspace, workspaceAdapter])
  const unavailableTab = (id: string) => createPortal(<p role="status" className="m-auto px-6 text-center text-caption text-muted-foreground">
    {t(workspace.activeScope.kind === 'project' ? 'inspector.project.unavailable' : 'inspector.project.required')}
  </p>, panelContainers.get(id), id)
  const tabContents = <>
    {panelWorkspace && workspaceAdapter ? <WorkspacePanelContents
      key={panelWorkspace.id}
      adapter={workspaceAdapter}
      containers={panelContainers}
      workspaceId={panelWorkspace.id}
      workspaceName={panelWorkspace.name}
      review={{ open: Boolean(panel.state.tabs.review), visible: conversationWorkspace && panel.isVisible('review') }}
      files={{ open: Boolean(panel.state.tabs.files), visible: conversationWorkspace && panel.isVisible('files') }}
      fileTabs={fileTabs}
      visibleFile={conversationWorkspace ? visibleFile : null}
      active={conversationWorkspace}
      sessionKey={conversationSessionKey}
      refreshRevision={`${conversationScopeKey(workspace.activeScope)}:${pi.status}:${pi.session?.isStreaming ?? false}:${commitRevision}`}
      lastTurnPaths={lastTurnPaths}
      onOpenFile={openFile}
      onShowReview={openReview}
      onAddWorkspaceReference={conversationReady ? addWorkspaceReferenceToComposer : undefined}
      onChangeTotals={setChangeTotals}
    /> : <>
      {panel.state.tabs.review ? unavailableTab('review') : null}
      {panel.state.tabs.files ? unavailableTab('files') : null}
      {fileTabs.map((path) => unavailableTab(`file:${path}`))}
    </>}
    {terminalMounted ? createPortal(<TerminalTabContent
      visible={conversationWorkspace && terminalVisible}
      hosts={terminalHostDock ? {
        tabs: terminalTabsHost,
        tools: terminalHostDock === 'right' ? rightTools : bottomTools,
        active: panel.state[terminalHostDock].activeId === 'terminal',
        onActivate: () => panel.select('terminal'),
        onEmpty: () => panel.close('terminal'),
      } : undefined}
      newSessionRequest={newTerminalRequest}
      createRequest={terminalCreateRequest}
      onCreateRequestHandled={(id) => setTerminalCreateRequest((current) => current?.id === id ? undefined : current)}
      scope={workspace.activeScope}
      scopeName={workspace.activeScope.kind === 'project' ? workspace.workspace?.name ?? '' : t('conversation.projectless')}
      projectIds={workspace.recentProjects.map((project) => project.id)}
      onOpenTerminalSettings={() => setSettingsSection('terminal')}
    />, panelContainers.get('terminal')) : null}
    {panel.state.tabs.sidechat ? createPortal(<SideConversationsPanel request={sideQuestion}
      ownerKey={`${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId ?? 'unselected'}`} ready={conversationReady}
      visible={conversationWorkspace && panel.isVisible('sidechat')} />, panelContainers.get('sidechat')) : null}
    {panel.state.tabs.subagent && selectedSubagentCall ? createPortal(<SubagentExecutionPanel call={selectedSubagentCall} onClose={closeSubagentExecution} />, panelContainers.get('subagent')) : null}
    {panel.state.tabs.command && selectedCommandCall ? createPortal(<CommandExecutionPanel call={selectedCommandCall} onClose={closeCommandExecution} />, panelContainers.get('command')) : null}
  </>
  const compactSettingsDetailVisible = frameLayoutMode === 'settings-compact' && compactSettingsDetailOpen
  const contextPanelVisible = frameNav.contextPanelOpen && !compactSettingsDetailVisible

  return (
    <TooltipProvider delayDuration={350}>
      <TerminalActionsContext.Provider value={{ scope: workspace.activeScope, open: openTerminalHere, openExternal: openExternalHere }}>
      <PrecisionReferencesProvider ownerKey={`${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId ?? 'unselected'}`}
        askSideQuestion={conversationReady ? askSideQuestion : undefined}
        workspaceId={workspace.activeScope.kind === 'project' ? workspace.activeScope.workspaceId : null}>
      <ConversationSearchDialog open={searchOpen} onOpenChange={setSearchOpen} initialScope={searchScope} onNavigate={navigateSearch} onOpenResult={openSearchResult} />
      <ConversationExportDialog target={exportTarget} conversationName={exportName} onClose={() => setExportTarget(null)} />
      {importScope && <ConversationImportDialog initialScope={importScope} projects={workspace.recentProjects}
        onCommit={commitImportedConversation} onClose={() => setImportScope(null)} />}
      <div className="flex h-screen w-full min-w-0 flex-col overflow-hidden bg-window text-foreground">
        {externalOpenError ? <div role="alert" className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2 text-caption">
          <span className="min-w-0 flex-1 text-destructive">{externalOpenError.label ? `${externalOpenError.label}: ` : ''}{t(externalOpenError.code === 'TERMINAL_EXTERNAL_APP_UNAVAILABLE' ? 'terminal.drawer.externalUnavailable' : 'terminal.drawer.externalLaunchFailed')}</span>
          <Button variant="ghost" size="xs" onClick={() => openExternalHere(externalOpenError.scope, externalOpenError.relativeDirectory, externalOpenError.appId, externalOpenError.label)}>{t('common.retry')}</Button>
          {workspaceAdapter ? <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="xs">{t('terminal.drawer.chooseExternalOnce')}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <TerminalExternalAppMenu standalone terminalApi={workspaceAdapter.terminal} disabled={false}
                onOpen={(appId, appName) => openExternalHere(externalOpenError.scope, externalOpenError.relativeDirectory, appId, appName)} />
            </DropdownMenuContent>
          </DropdownMenu> : null}
          <Button variant="ghost" size="xs" onClick={() => { setExternalOpenError(null); setSettingsSection('terminal') }}>{t('terminal.drawer.openSettings')}</Button>
          <Button variant="ghost" size="xs" onClick={() => setExternalOpenError(null)}>{t('common.close')}</Button>
        </div> : null}
        {nativeOpenFailed ? <div role="alert" className="app-drag flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-surface py-1.5 pr-3 pl-4 text-caption text-destructive mac:pl-[calc(var(--traffic-light-gutter)+8px)]">
          <span className="flex-1">{t('notifications.openFailed')}</span>
          <Button variant="ghost" size="xs" onClick={dismissNativeError}>{t('notifications.localDismiss')}</Button>
        </div> : null}
        <div className="relative flex min-h-0 flex-1">
          <ActivityRail
            rail={rail}
            onRailChange={setRail}
            onExitFullScreen={windowFullScreen ? () => { void window.pipilot?.window.exitFullScreen().catch(() => undefined) } : undefined}
            contextPanelOpen={contextPanelVisible}
            onToggleContextPanel={compactSettingsDetailVisible ? () => {
              closeCompactSettingsDetail()
              if (!frameNav.contextPanelOpen) toggleContextPanel()
            } : toggleContextPanel}
            onNewTask={newPrimarySession}
            newTaskDisabled={workspace.activeScope.kind === 'project' && workspace.workspace?.available === false}
            onOpenAbout={() => setSettingsSection('about')}
            onOpenNotification={openNotification}
            width={panelLayout.contextPanelWidth}
          >
            <ContextPanel
              rail={rail}
              hidden={!contextPanelVisible}
              showHeader={false}
              className="min-h-0 w-full flex-1 border-r-0"
            >
              <SessionsPanel
                onSearchAll={() => { setSearchScope('all'); setSearchOpen(true) }}
                hidden={!conversationWorkspace}
                conversationReady={conversationReady}
                renamingSelectionToken={renamingToken}
                deletingSelectionToken={deletingSelectionToken}
                isOpeningSessionRow={isOpeningSessionRow}
                onSelect={openConversation}
                onExport={exportCatalogConversation}
                onImport={setImportScope}
                onNewPrimary={newPrimarySession}
                onNewProjectless={newProjectlessSession}
                onRenameStart={(item) => setRenamingToken(item.summary.selectionToken)}
                onRenameCommit={(item, nextTitle) => {
                  const currentTitle = sidebarConversationTitle(item.summary)
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
                onRevealWorkspace={(workspaceId) => {
                  run(async () => { await window.pipilot?.workspace.reveal(workspaceId) })
                }}
                onRemoveWorkspace={(project) => {
                  if (removingProjectId) return
                  setProjectRemovalError(null)
                  setPendingProjectRemoval(project)
                }}
              />
              {frameNav.route.workspace === 'settings' && !compactSettingsDetailVisible && (
                <SettingsNavigation section={settingsSection} onSelect={setSettingsSection} onBack={() => setRail('sessions')} />
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
            hidden={!conversationWorkspace || panel.full}
            className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden bg-surface [--toolbar-inset:var(--frame-header-h)]"
          >
            {/* macOS 27 unified toolbar floats over the transcript, which scrolls beneath its frosted glass. */}
            <div className="absolute inset-x-0 top-0 z-30 flex flex-col" data-toolbar-overlay>
            <ConversationHeader
              onSearch={() => { setSearchScope('current'); setSearchOpen(true) }}
              title={title}
              ownerKey={conversationSessionKey}
              projectName={workspace.activeScope.kind === 'project' ? workspace.workspace?.name : undefined}
              status={conversationReady ? pi.status : undefined}
              onNavigate={navigateConversationOutline}
              onNewConversation={newPrimarySession}
              terminalOpen={terminalVisible}
              onToggleTerminal={toggleTerminal}
              onShowChanges={projectAvailable ? openReview : undefined}
              changeTotals={projectAvailable ? changeTotals : null}
              gitControls={panelWorkspace ? <div className="glass toolbar-group" data-git-controls>
                <OpenInEditorButton workspaceId={panelWorkspace.id} variant="icon" />
                {changeTotals?.gitAvailable ? <CommitButton workspaceId={panelWorkspace.id} model={commitModel} disabled={!changeTotals.files}
                  onCommitted={() => setCommitRevision((value) => value + 1)} /> : null}
              </div> : undefined}
              summaryOpen={summaryOpen}
              onToggleSummary={conversationReady ? () => setSummaryOpen((open) => !open) : undefined}
              sessionVisible={conversationReady}
              inspectorOpen={panel.rightVisible}
              branch={conversationReady ? workspace.workspace?.branch ?? '' : ''}
              stats={conversationReady ? pi.stats : null}
              onToggleInspector={panel.toggleTabs}
              compacting={Boolean(compactFeedback.pending)}
              onCompact={() => {
                if (!conversationReady) return
                void compactFeedback.run('compact', () => actions.compact(), t('chat.compactionFailed'))
              }}
            />
            {compactFeedback.error ? (
              <div role="alert" data-conversation-action-error="compact" className="toolbar-material shrink-0 break-words px-5 py-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive">
                <MarkdownContent markdown={compactFeedback.error} />
              </div>
            ) : compactFeedback.pending ? (
              <p role="status" className="toolbar-material shrink-0 px-5 py-2 text-caption text-muted-foreground">
                {t('chat.compacting')}
              </p>
            ) : null}
            {paletteStopFeedback.error ? (
              <div role="alert" data-conversation-action-error="stop" className="toolbar-material shrink-0 break-words px-5 py-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive">
                <MarkdownContent markdown={paletteStopFeedback.error} />
              </div>
            ) : null}
            </div>
            <ConversationTranscript
              emptyState={<ConversationWelcome
                selected={conversationReady}
                onStartWriting={startWriting}
                starting={starting}
                projectName={workspace.activeScope.kind === 'project' ? workspace.workspace?.name : undefined}
                onOpenProject={() => { requestSwitch(async () => { await workspace.chooseWorkspace() }); setRail('sessions') }}
              />}
              presentation={conversation}
              sessionKey={conversationSessionKey}
              jumpRequest={conversationJump}
              status={pi.status}
              onFork={actions.fork}
              onExportResponse={(anchorEntryId) => exportConversation({ kind: 'response', anchorEntryId })}
              onExportMessage={(entryId) => exportConversation({ kind: 'message', entryId })}
              onPlanAction={runPlanAction}
              selectedSubagentId={panel.isVisible('subagent') ? selectedSubagentCall?.id ?? null : null}
              onOpenSubagent={openSubagentExecution}
              onOpenCommand={openCommandExecution}
            />
            <Composer
              status={conversationReady ? (
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
              notices={conversationReady ? <ConversationNotices /> : null}
              planMode={conversationReady ? extension.planMode : null}
              goalMode={conversationReady ? extension.goalMode : null}
              conversationEmpty={conversationReady && pi.session?.messageCount === 0}
              onExitPlanMode={() => runPlanAction('exit')}
              onOpenIntegrations={() => {
                setIntegrationsTab('packages')
                setSettingsSection('integrations')
              }}
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
              textInsertionRequest={composerTextInsertionRequest}
              focusRequest={focusRequest}
              scopeKey={composerScopeKey}
              draftKey={`${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId ?? 'unselected'}`}
              operationOwnerKey={operationOwnerKey}
              sendShortcut={settings.composer.sendShortcut}
              runningSubmitPreference={settings.composer.runningSubmit}
              supportsImages={selectedModel?.input.includes('image') ?? false}
              onModelChange={actions.selectModel}
              onThinkingChange={actions.selectThinking}
              onManageModels={(add) => {
                if (add) requestModelsQuickAdd()
                setSettingsSection('models')
              }}
              onSubmit={submitComposer}
              onCheckSubmission={actions.checkSubmission}
              onStop={actions.abort}
              onRunningSubmitPreferenceChange={(runningSubmit) => {
                updateSettings({ composer: { runningSubmit } })
              }}
              onSetQueueMode={actions.setQueueMode}
              onPromoteFollowUp={actions.promoteFollowUp}
              onRemoveQueuedMessage={actions.removeQueuedMessage}
              onMoveQueuedMessage={actions.moveQueuedMessage}
              onResumeQueue={actions.resumeQueue}
              onClearQueue={actions.clearQueue}
              onCompleteCommandArguments={conversationReady
                ? actions.completeCommandArguments
                : undefined}
              onSearchContext={workspace.activeScope.kind === 'project'
                ? workspace.searchWorkspacePaths
                : undefined}
            />
            <BottomDock
              open={conversationWorkspace && panel.bottomVisible}
              containers={panelContainers}
              tabIds={panel.state.bottom.tabIds}
              onHide={() => panel.setBottom(false)}
              terminalActive={panel.state.bottom.activeId === 'terminal'}
              {...dockStrip('bottom')}
            />
          </main>

          {frameNav.settingsVisited && (
            <React.Suspense fallback={<div hidden={conversationWorkspace} className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground" role="status"><TbLoader2 className="mr-2 size-4 animate-spin" aria-hidden />{t('settings.loadingPage')}</div>}>
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
            </React.Suspense>
          )}

          {conversationWorkspace && panel.rightVisible && !compactConversation && (
            <>
              {!panel.full && <PanelResizeHandle
                width={panelLayout.inspectorWidth}
                min={INSPECTOR_MIN_WIDTH}
                max={INSPECTOR_MAX_WIDTH}
                defaultWidth={INSPECTOR_DEFAULT_WIDTH}
                label={t('panel.resizeInspector')}
                onChange={(inspectorWidth) => {
                  setPanelLayout((current) => ({ ...current, inspectorWidth }))
                }}
                side="right"
              />}
              <InspectorPortalHost container={rightDockContainer} expanded={panel.full} />
            </>
          )}
        </div>
      </div>

      {compactConversation && conversationWorkspace && (
        <Dialog
          open={compactInspectorVisible}
          onOpenChange={setCompactInspectorOpen}
        >
          <DialogContent
            showCloseButton={false}
            className="flex flex-col translate-x-0 translate-y-0 gap-0 rounded-none rounded-l-2xl bg-surface p-0"
            onInteractOutside={(event) => {
              // The retained portal has stable React ancestry but moves into this dialog's DOM.
              const target = event.detail.originalEvent.target
              if (target instanceof Node && rightDockContainer.contains(target)) event.preventDefault()
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
            <InspectorPortalHost container={rightDockContainer} />
          </DialogContent>
        </Dialog>
      )}

      {createPortal(rightDock, rightDockContainer)}
      {tabContents}
      <ConversationSummaryCard
        open={conversationWorkspace && summaryOpen}
        onOpenChange={setSummaryOpen}
        context={<ConversationContextPanel key={conversationSessionKey ?? 'unselected'} presentation={conversation}
          planMode={extension.planMode} goalMode={extension.goalMode}
          onRevealPlan={revealPlanFromOverview} onGoalAction={runGoalAction}
          onNavigate={navigateContextRecord} onSuggest={(text) => { setSummaryOpen(false); suggestNextAction(text) }} />}
        branch={conversationReady ? workspace.workspace?.branch ?? '' : ''}
        changeTotals={projectAvailable ? changeTotals : null}
        onOpenReview={projectAvailable ? () => { setSummaryOpen(false); openReview() } : undefined}
        workspaceId={panelWorkspace?.id}
        gitActions={panelWorkspace && changeTotals?.gitAvailable ? <CommitButton variant="summary" workspaceId={panelWorkspace.id} model={commitModel}
          disabled={!changeTotals.files} onCommitted={() => setCommitRevision((value) => value + 1)} /> : undefined}
      />

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
                  ? sidebarConversationTitle(pendingDeletion.summary, t('sidebar.session.untitled'))
                  : t('sidebar.session.untitled'),
              })}
              {deletingCurrentSession && (
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
                if (deletingCurrentSession || openingSession?.selectionToken === target.summary.selectionToken) {
                  cancelStartWriting()
                  abandonSessionOpening()
                }
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
                if (workspace.activeScope.kind === 'project' && workspace.activeScope.workspaceId === target.id) {
                  cancelStartWriting()
                }
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
      </PrecisionReferencesProvider>
      </TerminalActionsContext.Provider>
    </TooltipProvider>
  )
}
