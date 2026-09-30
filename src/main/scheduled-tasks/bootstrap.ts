import { join } from 'node:path'
import { Notification } from 'electron'
import type { OfficialPiSessionCatalog } from '../conversations/official-pi-session-catalog'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import type { WorkspaceRepository } from '../repositories/workspace-repository'
import { ConversationMcpAuditRepository } from '../external-control/audit-repository'
import { ConversationMcpControlService } from '../external-control/conversation-control-service'
import { ConversationMcpInventoryService } from '../external-control/conversation-inventory'
import { ExternalControlIdentityRepository } from '../external-control/identity-repository'
import { ConversationMcpOperationRegistry } from '../external-control/operation-registry'
import { ScheduledTaskRepository } from './repository'
import { ScheduledTaskService } from './service'
import type { ScheduledRun } from '../../shared/scheduled-tasks'

export function createScheduledTaskFeature(options: {
  directory: string
  catalog: OfficialPiSessionCatalog
  runtime: PiRuntimeFrontend
  workspaces: WorkspaceRepository
  desktopEnabled(): boolean
  notificationBody(run: ScheduledRun): string
  revealWindow(): void
}) {
  const identity = new ExternalControlIdentityRepository(join(options.directory, 'identity.json'))
  const inventory = new ConversationMcpInventoryService(options.workspaces, options.catalog, options.runtime, identity)
  const audit = new ConversationMcpAuditRepository(join(options.directory, 'operations.jsonl'))
  const control = new ConversationMcpControlService(inventory, options.runtime, new ConversationMcpOperationRegistry(), audit)
  const native = new Set<Notification>()
  const service = new ScheduledTaskService({
    repository: new ScheduledTaskRepository(join(options.directory, 'ledger.json')), inventory, control,
    notify(run) {
      if (!options.desktopEnabled() || !Notification.isSupported()) return
      const notification = new Notification({ title: run.taskName, body: options.notificationBody(run) })
      native.add(notification)
      notification.once('click', options.revealWindow)
      notification.once('close', () => native.delete(notification))
      notification.show()
    },
  })
  service.initialize()
  return {
    service,
    async dispose() {
      await service.dispose()
      await control.dispose()
      for (const notification of native) notification.close()
      native.clear()
    },
  }
}
