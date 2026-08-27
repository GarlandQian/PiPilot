import type { OfficialPiSessionCatalog } from '../conversations/official-pi-session-catalog'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import type { WorkspaceRepository } from '../repositories/workspace-repository'
import { ConversationMcpAuditRepository } from './audit-repository'
import { ConversationMcpBridgeServer } from './bridge-server'
import { ConversationMcpControlService } from './conversation-control-service'
import { ConversationMcpInventoryService } from './conversation-inventory'
import type { ExternalControlDescriptorRepository } from './descriptor-repository'
import type { ExternalControlIdentityRepository } from './identity-repository'
import type {
  ExternalControlLifecycleSession,
  ExternalControlLifecycleSessionCallbacks,
} from './lifecycle-service'
import { ConversationMcpOperationRegistry } from './operation-registry'

export interface CreateExternalControlSessionOptions {
  auditPath: string
  callbacks: ExternalControlLifecycleSessionCallbacks
  catalog: OfficialPiSessionCatalog
  descriptorRepository: ExternalControlDescriptorRepository
  identityRepository: ExternalControlIdentityRepository
  runtimeFrontend: PiRuntimeFrontend
  workspaceRepository: WorkspaceRepository
}

export function createExternalControlSession({
  auditPath,
  callbacks,
  catalog,
  descriptorRepository,
  identityRepository,
  runtimeFrontend,
  workspaceRepository,
}: CreateExternalControlSessionOptions): ExternalControlLifecycleSession {
  const inventory = new ConversationMcpInventoryService(
    workspaceRepository,
    catalog,
    runtimeFrontend,
    identityRepository,
  )
  const operations = new ConversationMcpOperationRegistry()
  const audit = new ConversationMcpAuditRepository(auditPath)
  const control = new ConversationMcpControlService(
    inventory,
    runtimeFrontend,
    operations,
    audit,
  )
  const bridge = new ConversationMcpBridgeServer({
    descriptorRepository,
    handler: (method, params, signal) =>
      control.handleBridgeRequest(method, params, signal),
    onClientCountChanged: callbacks.onClientCountChanged,
  })
  return {
    async start() {
      await bridge.start()
    },
    closeBridge: () => bridge.close(),
    disposeControl: () => control.dispose(),
    getConversationLabel: (conversationId) =>
      control.getConversationLabel(conversationId),
    subscribeOperations: (listener) => control.subscribeOperations(listener),
  }
}
