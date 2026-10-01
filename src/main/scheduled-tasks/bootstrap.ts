import { join } from 'node:path'
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
import { createScheduledFailureNotifier } from './notifications'
import type { TaskNotificationService } from '../notifications/task-notification-service'

export function createScheduledTaskFeature(options: {
  directory: string
  catalog: OfficialPiSessionCatalog
  runtime: PiRuntimeFrontend
  workspaces: WorkspaceRepository
  notifications: Pick<TaskNotificationService, 'reportScheduledPreflightFailure'>
}) {
  const identity = new ExternalControlIdentityRepository(join(options.directory, 'identity.json'))
  const inventory = new ConversationMcpInventoryService(options.workspaces, options.catalog, options.runtime, identity)
  const audit = new ConversationMcpAuditRepository(join(options.directory, 'operations.jsonl'))
  const control = new ConversationMcpControlService(inventory, options.runtime, new ConversationMcpOperationRegistry(), audit)
  // Scheduled prompts use the same Runtime as ordinary conversation prompts.
  // TaskNotificationService observes their settled outcome and owns both
  // banners and completion sound, including visibility and preference checks.
  // Only pre-acceptance failures use the same service's scheduler fallback.
  const service = new ScheduledTaskService({
    repository: new ScheduledTaskRepository(join(options.directory, 'ledger.json')), inventory, control,
    notify: createScheduledFailureNotifier(control, options.notifications),
  })
  service.initialize()
  return {
    service,
    async dispose() {
      await service.dispose()
      await control.dispose()
    },
  }
}
