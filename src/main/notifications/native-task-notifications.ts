import { Notification } from 'electron'
import type { TaskNotification } from '../../shared/task-notifications'
import type { NativeTaskNotificationAdapter } from './task-notification-service'

/** Desktop notifications deliberately contain no project, task, prompt or response text. */
export function createNativeTaskNotifications(getLocale: () => string): NativeTaskNotificationAdapter {
  return {
    supported: () => Notification.isSupported(),
    show(kind: TaskNotification['kind'], onClick: () => void) {
      const chinese = getLocale().toLowerCase().startsWith('zh')
      const body = chinese
        ? { completed: '一项任务已完成。', failed: '一项任务运行失败。', 'input-required': '一项任务需要你处理。' }[kind]
        : { completed: 'A task has completed.', failed: 'A task has failed.', 'input-required': 'A task needs your input.' }[kind]
      const notification = new Notification({ title: 'PiPilot', body, silent: true })
      notification.on('click', onClick)
      notification.on('failed', () => { /* Desktop delivery is best effort. */ })
      notification.show()
      return { close: () => notification.close() }
    },
  }
}
