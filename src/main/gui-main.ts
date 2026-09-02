import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  app,
  BrowserWindow,
  crashReporter,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from 'electron'
import {
  createApplicationStoragePaths,
  resolveTestUserDataOverride,
} from './application-storage'
import { MainDiagnostics } from './diagnostics/main-diagnostics'
import { registerAppIpc } from './ipc/register-app-ipc'
import { registerTerminalIpc } from './ipc/register-terminal-ipc'
import { registerWorkspaceIpc } from './ipc/register-workspace-ipc'
import { registerLocalPiIpc } from './ipc/register-local-pi-ipc'
import { registerMcpConfigIpc } from './ipc/register-mcp-config-ipc'
import { registerModelsConfigIpc } from './ipc/register-models-config-ipc'
import { registerPiIntegrationsIpc } from './ipc/register-pi-integrations-ipc'
import { registerSessionCatalogIpc } from './ipc/register-session-catalog-ipc'
import { registerConversationIpc } from './ipc/register-conversation-ipc'
import { SettingsRepository } from './repositories/settings-repository'
import { WorkspaceRepository } from './repositories/workspace-repository'
import { ObservedPiSessionDirectoryRepository } from './repositories/observed-pi-session-directory-repository'
import { ConversationNavigationRepository } from './repositories/conversation-navigation-repository'
import { WorkspaceContentService } from './workspace/workspace-content-service'
import { registerAppProtocol, registerAppSchemePrivileges } from './security/app-protocol'
import { configureSessionSecurity } from './security/session-security'
import { createApplicationUrlPolicy } from './security/url-policy'
import { createMainWindow } from './windows/create-main-window'
import { TerminalService } from './terminal/terminal-service'
import { ProjectHostPool } from './pi-host/project-host-pool'
import { PiRuntimeFrontend } from './pi-host/pi-runtime-frontend'
import {
  ConversationScopeResolver,
} from './conversations/conversation-scope-resolver'
import { OfficialPiSessionCatalog } from './conversations/official-pi-session-catalog'
import { OfficialPiSessionActivationService } from './conversations/official-pi-session-activation-service'
import { OfficialPiSessionDeletionService } from './conversations/official-pi-session-deletion-service'
import { ConversationContextService } from './conversations/conversation-context-service'
import {
  McpConfigController,
  McpConfigService,
} from './mcp/mcp-config-service'
import {
  ModelsConfigController,
  ModelsConfigService,
} from './models-config/models-config-service'
import {
  WindowStateRepository,
  type WindowStateController,
} from './windows/window-state'
import { LocalPiManagementHost } from './local-pi-management/local-pi-management-host'
import { LocalPiIntegrationService } from './local-pi-management/local-pi-integration-service'
import { createProductionApplicationUpdateProvider } from './application-update/providers'
import { ApplicationUpdateService } from './application-update/service'
import { ApplicationShutdownCoordinator } from './application-update/shutdown-coordinator'
import { registerApplicationUpdateIpc } from './ipc/register-application-update-ipc'
import { registerExternalControlIpc } from './ipc/register-external-control-ipc'
import {
  resolveExternalControlLauncherSource,
  resolveExternalControlMcpConfiguration,
} from './external-control/command-resolver'
import { ExternalControlDescriptorRepository } from './external-control/descriptor-repository'
import { ExternalControlIdentityRepository } from './external-control/identity-repository'
import { ExternalControlLifecycleService } from './external-control/lifecycle-service'
import { ExternalControlPreferenceRepository } from './external-control/preference-repository'
import { createExternalControlSession } from './external-control/session-factory'
import { ExternalControlLauncherService } from './external-control/launcher-service'

registerAppSchemePrivileges()

if (process.platform === 'darwin') {
  // PiPilot's current macOS packages intentionally use an ad-hoc signature.
  // Chromium's default browser-data encryption binds its
  // "PiPilot Safe Storage" keychain access to the current code identity, so
  // rebuilding the app can otherwise trigger a blocking password prompt on
  // every new build. PiPilot does not use Chromium cookies or password storage
  // for application secrets; keep this switch until Developer ID signing is
  // introduced and the system keychain policy is reviewed together with it.
  app.commandLine.appendSwitch('use-mock-keychain')
}

app.enableSandbox()

const developmentUrl = process.env.ELECTRON_RENDERER_URL
const policy = createApplicationUrlPolicy(developmentUrl)
const mainOutputDirectory = basename(import.meta.dirname) === 'chunks'
  ? resolve(import.meta.dirname, '..')
  : import.meta.dirname

const testUserDataOverride = resolveTestUserDataOverride({
  candidate: process.env.PIPILOT_E2E_USER_DATA,
  isPackaged: app.isPackaged,
  packagedSmoke: process.env.PIPILOT_PACKAGED_SMOKE,
})

function isPathInside(parent: string, candidate: string) {
  const child = relative(resolve(parent), resolve(candidate))
  return child !== '' &&
    child !== '..' &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
}
if (testUserDataOverride) {
  mkdirSync(testUserDataOverride, { recursive: true, mode: 0o700 })
  app.setPath('userData', testUserDataOverride)
}

const applicationStorage = createApplicationStoragePaths(app.getPath('userData'))
const diagnostics = new MainDiagnostics({
  enabled: app.isPackaged,
  logFile: applicationStorage.mainLogFile,
})

try {
  mkdirSync(applicationStorage.browserDataDirectory, {
    recursive: true,
    mode: 0o700,
  })
  app.setPath('sessionData', applicationStorage.browserDataDirectory)
} catch {
  diagnostics.record('warn', 'BROWSER_DATA_PATH_CONFIGURATION_FAILED')
}

if (app.isPackaged) {
  try {
    app.setAppLogsPath(applicationStorage.logDirectory)
  } catch {
    console.error('[PiPilot] PRODUCTION_LOG_PATH_CONFIGURATION_FAILED')
  }
  diagnostics.initialize()

  try {
    mkdirSync(applicationStorage.crashDirectory, {
      recursive: true,
      mode: 0o700,
    })
    app.setPath('crashDumps', applicationStorage.crashDirectory)
    crashReporter.start({
      productName: 'PiPilot',
      uploadToServer: false,
      compress: true,
    })
  } catch {
    diagnostics.record('error', 'CRASH_REPORTER_INITIALIZATION_FAILED')
  }
  diagnostics.record('info', 'APPLICATION_BOOTSTRAP')
}

const settingsRepository = new SettingsRepository(
  join(app.getPath('userData'), 'settings.json'),
  {
    onDiagnostic(code) {
      if (code === 'created') return
      diagnostics.scoped('warn', 'SETTINGS_REPOSITORY', code)
    },
  },
)
const workspaceRepository = new WorkspaceRepository(
  join(app.getPath('userData'), 'workspaces.json'),
  {
    onDiagnostic(code) {
      if (code === 'created') return
      diagnostics.scoped('warn', 'WORKSPACE_REPOSITORY', code)
    },
  },
)
const projectlessCwd = join(app.getPath('userData'), 'general-chat', 'workspace')
const conversationScopeResolver = new ConversationScopeResolver(
  workspaceRepository,
  projectlessCwd,
)
const conversationNavigationRepository = new ConversationNavigationRepository(
  join(app.getPath('userData'), 'conversation-navigation.json'),
  {
    onDiagnostic(code) {
      if (code === 'created') return
      diagnostics.scoped('warn', 'CONVERSATION_NAVIGATION_REPOSITORY', code)
    },
  },
)
const observedPiSessionDirectories = new ObservedPiSessionDirectoryRepository(
  join(app.getPath('userData'), 'observed-pi-session-directories.json'),
  {
    onDiagnostic(code) {
      if (code === 'created') return
      diagnostics.scoped('warn', 'PI_SESSION_DIRECTORY_REPOSITORY', code)
    },
  },
)
const officialPiSessionCatalog = new OfficialPiSessionCatalog(
  conversationScopeResolver,
  observedPiSessionDirectories,
)
const workspaceContentService = new WorkspaceContentService(
  () => {
    const scope = conversationNavigationRepository.get().activeScope
    return scope.kind === 'project'
      ? workspaceRepository.getLocation(scope.workspaceId)
      : undefined
  },
)
const e2eTerminalShell = !app.isPackaged
  ? process.env.PIPILOT_E2E_TERMINAL_SHELL
  : undefined
const terminalService = new TerminalService(
  () => conversationNavigationRepository.get().activeScope,
  (scope) => conversationScopeResolver.prepare(scope),
  e2eTerminalShell
    ? {
        resolveShell: () => ({
          file: resolve(e2eTerminalShell),
          args: [],
          label: basename(e2eTerminalShell).slice(0, 128),
        }),
      }
    : {},
)

let mainWindow: BrowserWindow | null = null
let windowStateController: WindowStateController | null = null
let applicationTray: Tray | null = null
let traySettingsUnsubscribe: (() => boolean) | null = null
let piHostPool: ProjectHostPool | null = null
let piRuntimeFrontend: PiRuntimeFrontend | null = null
let localPiIpcController: ReturnType<typeof registerLocalPiIpc> | null = null
let mcpConfigController: McpConfigController | null = null
let modelsConfigController: ModelsConfigController | null = null
let piIntegrationsController: ReturnType<typeof registerPiIntegrationsIpc> | null = null
let piIntegrationService: LocalPiIntegrationService | null = null
let conversationIpcUnsubscribe: (() => void) | null = null
let applicationUpdateService: ApplicationUpdateService | null = null
let applicationUpdateIpcController: ReturnType<typeof registerApplicationUpdateIpc> | null = null
let externalControlService: ExternalControlLifecycleService | null = null
let externalControlIpcController: ReturnType<typeof registerExternalControlIpc> | null = null
let shutdownCoordinator: ApplicationShutdownCoordinator | null = null

function activeApplicationWork() {
  const primaryPi = Boolean(
    piRuntimeFrontend && piRuntimeFrontend.getSnapshot().state !== 'stopped',
  )
  const runtimePool = Boolean(
    piHostPool?.getSnapshot().hosts.some((host) =>
      host.state === 'starting' ||
      host.state === 'ready' ||
      host.state === 'stopping' ||
      host.runtimes.some((runtime) =>
        runtime.state === 'starting' ||
        runtime.state === 'ready' ||
        runtime.state === 'stopping',
      ),
    ),
  )
  return {
    primaryPi,
    runtimePool,
    terminals: terminalService.hasActiveTerminals(),
  }
}

async function disposeApplicationResources() {
  try {
    settingsRepository.flush()
  } catch {
    diagnostics.record('error', 'SETTINGS_SHUTDOWN_FLUSH_FAILED')
  }
  try {
    workspaceRepository.flush()
  } catch {
    diagnostics.record('error', 'WORKSPACE_SHUTDOWN_FLUSH_FAILED')
  }
  conversationNavigationRepository.flush()
  await Promise.allSettled([
    observedPiSessionDirectories.flush(),
    windowStateController?.flush(),
  ])

  applicationUpdateIpcController?.dispose()
  applicationUpdateIpcController = null
  applicationUpdateService?.dispose()
  applicationUpdateService = null
  externalControlIpcController?.dispose()
  externalControlIpcController = null
  localPiIpcController?.dispose()
  localPiIpcController = null
  piIntegrationsController?.dispose()
  piIntegrationsController = null
  mcpConfigController?.dispose()
  mcpConfigController = null
  modelsConfigController?.dispose()
  modelsConfigController = null
  conversationIpcUnsubscribe?.()
  conversationIpcUnsubscribe = null

  traySettingsUnsubscribe?.()
  traySettingsUnsubscribe = null
  applicationTray?.destroy()
  applicationTray = null

  try {
    await externalControlService?.dispose()
  } catch {
    diagnostics.record('error', 'EXTERNAL_CONTROL_SHUTDOWN_FAILED')
  }
  externalControlService = null

  const piFrontendShutdown = piRuntimeFrontend?.dispose() ?? Promise.resolve()
  const piPoolShutdown = piHostPool?.dispose() ?? Promise.resolve()
  const piIntegrationsShutdown = piIntegrationService?.dispose() ?? Promise.resolve()
  piIntegrationService = null
  await Promise.allSettled([
    piFrontendShutdown,
    piPoolShutdown,
    piIntegrationsShutdown,
    terminalService.dispose(),
  ])
}

function revealMainWindow() {
  if (process.platform === 'darwin') void app.dock?.show()
  if (!mainWindow || mainWindow.isDestroyed()) {
    void openMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function requestApplicationQuit() {
  if (shutdownCoordinator) {
    void shutdownCoordinator.requestQuit()
    return
  }
  app.quit()
}

function updateApplicationTrayMenu() {
  if (!applicationTray) return
  const configuredLocale = settingsRepository.get().settings.locale
  const locale = configuredLocale === 'system' ? app.getLocale() : configuredLocale
  const chinese = locale.toLowerCase().startsWith('zh')
  applicationTray.setContextMenu(Menu.buildFromTemplate([
    {
      label: chinese ? '显示 PiPilot' : 'Show PiPilot',
      click: revealMainWindow,
    },
    { type: 'separator' },
    {
      label: chinese ? '退出 PiPilot' : 'Quit PiPilot',
      click: requestApplicationQuit,
    },
  ]))
}

function createApplicationTray() {
  if (applicationTray) return

  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'build/tray-icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    const fallbackSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<path fill="#000" d="M 46 42 Q 43 44 39 44 Q 34 44 34 38 L 34 23 L 29 23 Q 29 32 27 38 Q 25 44 20 44 Q 16 44 16 40 Q 16 37 19 37 Q 21 37 23 40 Q 25 37 25 23 L 19 23 Q 16 23 16 28 L 13 28 Q 13 19 21 19 L 47 19 L 47 23 L 40 23 L 40 37 Q 40 40 43 40 Q 44 40 46 39 Z"/>' +
      '</svg>'
    icon = nativeImage.createFromDataURL(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`,
    )
  }
  icon = icon.resize({ width: 18, height: 18 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)

  applicationTray = new Tray(icon)
  applicationTray.setToolTip('PiPilot')
  updateApplicationTrayMenu()
  traySettingsUnsubscribe = settingsRepository.subscribe(
    updateApplicationTrayMenu,
  )
  applicationTray.on('click', revealMainWindow)
}

async function openMainWindow() {
  const stateRepository = new WindowStateRepository(
    join(app.getPath('userData'), 'window-state.json'),
  )
  const handle = await createMainWindow({
    developmentUrl,
    mainOutputDirectory,
    onHiddenToTray() {
      if (process.platform === 'darwin') app.dock?.hide()
    },
    onWindowCreated(window) {
      mainWindow = window
      window.once('closed', () => {
        if (mainWindow === window) mainWindow = null
      })
    },
    shouldHideOnClose: () => !(shutdownCoordinator?.isFinalizing ?? false),
    policy,
    stateRepository,
  })

  mainWindow = handle.window
  windowStateController = handle.stateController
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady()
    .then(async () => {
      app.setName('PiPilot')
      app.setAppUserModelId('com.pipilot.desktop')

      if (!developmentUrl) {
        registerAppProtocol(join(mainOutputDirectory, '../renderer'))
      }

      configureSessionSecurity(session.defaultSession, policy, () => mainWindow)
      settingsRepository.initialize()
      await workspaceRepository.initialize()
      conversationNavigationRepository.initialize()
      await observedPiSessionDirectories.initialize()
            piHostPool = new ProjectHostPool({
              onHostDiagnostic: (code) => diagnostics.record('error', code),
            })
          piRuntimeFrontend = new PiRuntimeFrontend(
            piHostPool,
            conversationScopeResolver,
          )
          const runtimeHost = piRuntimeFrontend
      const restartAffectedPiHosts = async (
        scope: { kind: 'global' } | { kind: 'project' },
        cwd: string,
      ) => {
        const active = runtimeHost.getSnapshot()
        const targets = piHostPool!.listHosts().filter((host) =>
          host.state !== 'stopped' &&
          (scope.kind === 'global' || host.cwd === cwd),
        )
        for (const host of targets) {
          if (active.state === 'ready' && active.cwd === host.cwd) {
            await runtimeHost.restart()
          } else {
            await piHostPool!.restart(host.scope)
          }
        }
      }
      const reloadAffectedPiRuntimes = async (
        scope: { kind: 'global' } | { kind: 'project' },
        cwd: string,
      ) => {
        await runtimeHost.reloadRuntimes(scope.kind === 'global' ? undefined : cwd)
      }
      const mcpConfigService = new McpConfigService({
        homeDirectory: app.getPath('home'),
        getActiveScope: () => conversationNavigationRepository.get().activeScope,
        scopeResolver: conversationScopeResolver,
      })
      mcpConfigController = new McpConfigController(
        mcpConfigService,
        runtimeHost,
        async (target) => {
          const cwd = target.kind === 'global'
            ? projectlessCwd
            : (await conversationScopeResolver.resolve({
                kind: 'project',
                workspaceId: target.workspaceId,
              })).cwd
          await restartAffectedPiHosts(target, cwd)
        },
      )
      const officialPiSessionActivation = new OfficialPiSessionActivationService(
        conversationScopeResolver,
        observedPiSessionDirectories,
        officialPiSessionCatalog,
        runtimeHost,
      )
      const officialPiSessionDeletion = new OfficialPiSessionDeletionService({
        activationService: officialPiSessionActivation,
        catalog: officialPiSessionCatalog,
        runtimeHost,
        trashItem: (path) => shell.trashItem(path),
        unlink,
      })
      const conversationContextService = new ConversationContextService({
        activationService: officialPiSessionActivation,
        deletionService: officialPiSessionDeletion,
        navigationRepository: conversationNavigationRepository,
        runtimeHost,
        scopeResolver: conversationScopeResolver,
        disposeScope: (scope) => terminalService.disposeScope(scope),
      })
          const piManagementHost = new LocalPiManagementHost({
            helperEntryPath: join(mainOutputDirectory, 'pi-management-helper.js'),
      })
      piIntegrationService = new LocalPiIntegrationService({
        getActiveScope: () => conversationNavigationRepository.get().activeScope,
        helperHost: piManagementHost,
        managedPackageStatePath: join(app.getPath('userData'), 'pi-managed-packages.json'),
        restartMarkerPath: join(app.getPath('userData'), 'pi-integrations-state.json'),
        runtimeHost,
        reloadHosts: reloadAffectedPiRuntimes,
        restartHosts: restartAffectedPiHosts,
        scopeResolver: conversationScopeResolver,
      })
      const externalControlDirectory = join(
        app.getPath('userData'),
        'external-control',
      )
      const externalControlDescriptor = new ExternalControlDescriptorRepository(
        join(externalControlDirectory, 'descriptor.json'),
      )
      const externalControlIdentity = new ExternalControlIdentityRepository(
        join(externalControlDirectory, 'identity.json'),
      )
      const externalControlPreference = new ExternalControlPreferenceRepository(
        join(externalControlDirectory, 'preferences.json'),
      )
      const windowsMcpExecutablePath = app.isPackaged && process.platform === 'win32'
        ? join(dirname(process.execPath), 'pipilot-mcp.exe')
        : undefined
      const testExternalControlExecutable = !app.isPackaged
        ? process.env.PIPILOT_E2E_EXTERNAL_CONTROL_EXECUTABLE
        : undefined
      const externalControlResolverOptions = {
        appImagePath: process.env.APPIMAGE,
        descriptorPath: externalControlDescriptor.path,
        executablePath: process.execPath,
        ...(windowsMcpExecutablePath
          ? { mcpExecutablePath: windowsMcpExecutablePath }
          : {}),
        isPackaged: app.isPackaged,
        ...(testExternalControlExecutable
          ? { testExecutablePath: testExternalControlExecutable }
          : {}),
      }
      const externalControlConfiguration = resolveExternalControlMcpConfiguration(
        externalControlResolverOptions,
      )
      const externalControlLauncherSource = resolveExternalControlLauncherSource(
        externalControlResolverOptions,
      )
      const testLauncherDirectoryCandidate =
        process.env.PIPILOT_E2E_EXTERNAL_CONTROL_LAUNCHER_DIRECTORY
      const testLauncherDirectory = process.env.PIPILOT_PACKAGED_SMOKE === '1' &&
        testLauncherDirectoryCandidate &&
        !/[\0\r\n]/u.test(testLauncherDirectoryCandidate) &&
        isAbsolute(testLauncherDirectoryCandidate) &&
        (!app.isPackaged || (
          testUserDataOverride &&
          isPathInside(testUserDataOverride, testLauncherDirectoryCandidate)
        ))
        ? resolve(testLauncherDirectoryCandidate)
        : undefined
      if (testLauncherDirectory) {
        mkdirSync(testLauncherDirectory, { recursive: true, mode: 0o700 })
      }
      const externalControlLauncher = new ExternalControlLauncherService({
        descriptorPath: externalControlDescriptor.path,
        executablePath: externalControlLauncherSource,
        homeDirectory: app.getPath('home'),
        isPackaged: app.isPackaged,
        receiptPath: join(externalControlDirectory, 'launcher-receipt.json'),
        ...(testLauncherDirectory ? { testTargetDirectory: testLauncherDirectory } : {}),
      })
      externalControlService = new ExternalControlLifecycleService({
        preferenceRepository: externalControlPreference,
        configuration: externalControlConfiguration,
        createSession: (callbacks) => createExternalControlSession({
          auditPath: join(externalControlDirectory, 'audit.jsonl'),
          callbacks,
          catalog: officialPiSessionCatalog,
          descriptorRepository: externalControlDescriptor,
          identityRepository: externalControlIdentity,
          runtimeFrontend: runtimeHost,
          workspaceRepository,
        }),
      })
      await externalControlService.initialize()
      shutdownCoordinator = new ApplicationShutdownCoordinator({
        dispose: disposeApplicationResources,
        quit: () => app.quit(),
      })
      registerAppIpc({ getMainWindow: () => mainWindow, policy, settingsRepository })
      externalControlIpcController = registerExternalControlIpc({
        getMainWindow: () => mainWindow,
        launcherService: externalControlLauncher,
        policy,
        service: externalControlService,
      })
      localPiIpcController = registerLocalPiIpc({
        activationService: officialPiSessionActivation,
        contextService: conversationContextService,
        getMainWindow: () => mainWindow,
        policy,
        runtimeHost,
        settingsRepository,
      })
      registerMcpConfigIpc({
        controller: mcpConfigController,
        getMainWindow: () => mainWindow,
        policy,
      })
      piIntegrationsController = registerPiIntegrationsIpc({
        getMainWindow: () => mainWindow,
        policy,
        service: piIntegrationService,
      })
      void piIntegrationService.ensureRecommendedPackages()
      const modelsConfigService = new ModelsConfigService({
        homeDirectory: app.getPath('home'),
        management: piIntegrationService,
      })
      modelsConfigController = new ModelsConfigController(
        modelsConfigService,
        runtimeHost,
        () => restartAffectedPiHosts({ kind: 'global' }, projectlessCwd),
      )
      registerModelsConfigIpc({
        controller: modelsConfigController,
        getMainWindow: () => mainWindow,
        policy,
      })
      conversationIpcUnsubscribe = registerConversationIpc({
        contextService: conversationContextService,
        getMainWindow: () => mainWindow,
        policy,
      })
      registerSessionCatalogIpc({
        catalog: officialPiSessionCatalog,
        contextService: conversationContextService,
        getMainWindow: () => mainWindow,
        policy,
      })
      registerTerminalIpc({
        getMainWindow: () => mainWindow,
        policy,
        terminalService,
      })
      registerWorkspaceIpc({
        getMainWindow: () => mainWindow,
        policy,
        repository: workspaceRepository,
        contentService: workspaceContentService,
        contextService: conversationContextService,
      })
      const updateProvider = await createProductionApplicationUpdateProvider({
        packaged: app.isPackaged,
        currentVersion: app.getVersion(),
        platform: process.platform,
        resourcesPath: process.resourcesPath,
        appImagePath: process.env.APPIMAGE,
        // Unsigned Windows NSIS updates remain disabled until the isolated
        // official updater canary proves integrity on a native runner.
        enableWindowsNative: false,
      })
      applicationUpdateService = new ApplicationUpdateService({
        provider: updateProvider,
        hasActiveWork: activeApplicationWork,
        requestInstallShutdown: (install) => {
          if (!shutdownCoordinator) {
            throw new Error('Application shutdown is unavailable.')
          }
          return shutdownCoordinator.requestInstall(install)
        },
      })
      applicationUpdateIpcController = registerApplicationUpdateIpc({
        getMainWindow: () => mainWindow,
        policy,
        service: applicationUpdateService,
      })
      await openMainWindow()
      createApplicationTray()
      diagnostics.record('info', 'APPLICATION_READY')

      app.on('activate', () => {
        revealMainWindow()
      })
    })
    .catch(() => {
      diagnostics.record('error', 'APPLICATION_STARTUP_FAILED')
      app.quit()
    })

  app.on('before-quit', (event) => {
    if (!shutdownCoordinator) return
    shutdownCoordinator.handleBeforeQuit(event)
  })
}
