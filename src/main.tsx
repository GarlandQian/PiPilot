import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '@/store/settings'
import { WorkspaceProvider } from '@/store/workspace'
import { PiRpcProvider } from '@/store/pi-rpc'
import { PiIntegrationsProvider } from '@/store/pi-integrations'
import { ApplicationUpdateProvider } from '@/store/application-update'
import { TaskNotificationsProvider } from '@/store/task-notifications'
import { ExternalControlProvider } from '@/store/external-control'
import { ConfigurationDocumentsProvider } from '@/store/configuration-documents'
import { RendererErrorBoundary } from '@/components/frame/RendererErrorBoundary'
import App from './App'
import { PopoutApp } from './popout/PopoutApp'
import '@/styles/globals.css'

const root = createRoot(document.getElementById('root')!)
// A conversation pop-out loads the same page with ?popout=<id>.
const popoutId = new URLSearchParams(window.location.search).get('popout')

root.render(window.pipilot && popoutId ? (
  <SettingsProvider>
    <RendererErrorBoundary>
      <PopoutApp popoutId={popoutId} />
    </RendererErrorBoundary>
  </SettingsProvider>
) : window.pipilot ? (
  <SettingsProvider>
    <RendererErrorBoundary>
      <WorkspaceProvider>
        <PiIntegrationsProvider>
          <ExternalControlProvider>
            <ApplicationUpdateProvider>
              <PiRpcProvider>
                <ConfigurationDocumentsProvider>
                  <TaskNotificationsProvider>
                    <App />
                  </TaskNotificationsProvider>
                </ConfigurationDocumentsProvider>
              </PiRpcProvider>
            </ApplicationUpdateProvider>
          </ExternalControlProvider>
        </PiIntegrationsProvider>
      </WorkspaceProvider>
    </RendererErrorBoundary>
  </SettingsProvider>
) : (
  <main className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
    <p className="text-caption text-destructive">PiPilot desktop bridge unavailable.</p>
  </main>
))
