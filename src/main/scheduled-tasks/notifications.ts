import type { ScheduledRun } from '../../shared/scheduled-tasks'
import type { ConversationMcpControlService } from '../external-control/conversation-control-service'
import type { TaskNotificationService } from '../notifications/task-notification-service'

/** Runtime-accepted work belongs exclusively to the ordinary outcome observer.
 * Only failures before acceptance need the scheduler's fallback notification. */
export function createScheduledFailureNotifier(
  control: Pick<ConversationMcpControlService, 'getOperation'>,
  notifications: Pick<TaskNotificationService, 'reportScheduledPreflightFailure'>,
) {
  return (run: ScheduledRun) => {
    if (run.status !== 'failed') return
    if (run.operationId) {
      let operation
      try { operation = control.getOperation({ operationId: run.operationId }).operation } catch { return }
      if (operation.operationId !== run.operationId || operation.conversationId !== run.conversationId ||
          operation.kind !== 'send_prompt' || operation.status !== 'failed' || operation.acceptedAt !== undefined) return
    }
    notifications.reportScheduledPreflightFailure({ runId: run.id, conversationId: run.conversationId })
  }
}
