import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { scheduledTaskChannels, scheduledTasksGetContract, scheduledTasksRemoveContract, scheduledTasksRunContract, scheduledTasksSaveContract, scheduledTasksSetEnabledContract, scheduledTasksTargetsContract } from '../../shared/ipc/scheduled-tasks-contracts'
import { scheduledTasksChangedSchema } from '../../shared/scheduled-tasks'
import { ScheduledTaskError, type ScheduledTaskService } from '../scheduled-tasks/service'
import { ExternalControlError } from '../../shared/external-control'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerScheduledTasksIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: ScheduledTaskService
}) {
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const map = async <T>(action: () => T | Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof ScheduledTaskError || error instanceof ExternalControlError) throw new MainProcessError(error.code, error.message, true)
      throw error
    }
  }
  const detach = service.subscribe((snapshot) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(scheduledTaskChannels.changed, scheduledTasksChangedSchema.parse({ eventId: randomUUID(), snapshot }))
  })
  const unregister = [
    registerValidatedHandler(scheduledTasksGetContract, trusted, () => service.get()),
    registerValidatedHandler(scheduledTasksSaveContract, trusted, ({ task }) => map(() => service.save(task))),
    registerValidatedHandler(scheduledTasksRemoveContract, trusted, ({ id }) => map(() => service.remove(id))),
    registerValidatedHandler(scheduledTasksRunContract, trusted, ({ id }) => map(() => service.runNow(id))),
    registerValidatedHandler(scheduledTasksSetEnabledContract, trusted, ({ id, enabled }) => map(() => service.setEnabled(id, enabled))),
    registerValidatedHandler(scheduledTasksTargetsContract, trusted, ({ input }) => map(() => service.listTargets(input))),
  ]
  return { dispose() { detach(); unregister.forEach((stop) => stop()) } }
}
