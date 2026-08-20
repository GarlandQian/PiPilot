import { createRoot } from 'react-dom/client'
import { SettingsProvider } from '@/store/settings'
import { WorkspaceProvider } from '@/store/workspace'
import { PiRpcProvider } from '@/store/pi-rpc'
import { PiIntegrationsProvider } from '@/store/pi-integrations'
import { ApplicationUpdateProvider } from '@/store/application-update'
import { ExternalControlProvider } from '@/store/external-control'
import App from './App'
import '@/styles/globals.css'

const root = createRoot(document.getElementById('root')!)

root.render(window.pipilot ? (
  <SettingsProvider>
    <WorkspaceProvider>
      <PiIntegrationsProvider>
        <ExternalControlProvider>
          <ApplicationUpdateProvider>
            <PiRpcProvider>
              <App />
            </PiRpcProvider>
          </ApplicationUpdateProvider>
        </ExternalControlProvider>
      </PiIntegrationsProvider>
    </WorkspaceProvider>
  </SettingsProvider>
) : (
  <main className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
    <p className="text-caption text-destructive">PiPilot desktop bridge unavailable.</p>
  </main>
))
