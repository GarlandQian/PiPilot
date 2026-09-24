import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  ipcChannels,
  notificationsGetContract,
  notificationsPresentationContract,
  notificationsReadContract,
  notificationsClearContract,
  notificationsResolveContract,
} from '../../shared/ipc/contracts'
import { notificationChangedEventSchema } from '../../shared/task-notifications'
import { TaskNotificationError, type TaskNotificationService } from '../notifications/task-notification-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerNotificationsIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: TaskNotificationService
}) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  const unsubscribe = service.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(ipcChannels.notificationsChanged, notificationChangedEventSchema.parse({ eventId: randomUUID(), snapshot }))
  })
  const unregister = [
    registerValidatedHandler(notificationsGetContract, isTrustedSender, () => service.get()),
    registerValidatedHandler(notificationsPresentationContract, isTrustedSender, ({ presentation }) => service.setPresentation(presentation)),
    registerValidatedHandler(notificationsReadContract, isTrustedSender, ({ id }) => service.markRead(id)),
    registerValidatedHandler(notificationsClearContract, isTrustedSender, ({ id }) => service.clear(id)),
    registerValidatedHandler(notificationsResolveContract, isTrustedSender, async ({ id }) => {
      try { return await service.resolveTarget(id) }
      catch (error) {
        throw new MainProcessError(error instanceof TaskNotificationError ? error.code : 'NOTIFICATION_TARGET_UNAVAILABLE', 'The task for this notification is no longer available.')
      }
    }),
  ]
  return { dispose() { unsubscribe(); for (const stop of unregister) stop() } }
}
