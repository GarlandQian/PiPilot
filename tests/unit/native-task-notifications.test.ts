import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ options: [] as unknown[], clicks: [] as Array<() => void> }))
vi.mock('electron', () => ({
  Notification: class {
    static isSupported() { return true }
    constructor(options: unknown) { state.options.push(options) }
    on(event: string, callback: () => void) { if (event === 'click') state.clicks.push(callback) }
    show() {}
    close() {}
  },
}))

import { createNativeTaskNotifications } from '../../src/main/notifications/native-task-notifications'

describe('native task notifications', () => {
  it('uses silent generic localized content and forwards clicks', () => {
    const click = vi.fn()
    const english = createNativeTaskNotifications(() => 'en-US')
    expect(english.supported()).toBe(true)
    english.show('completed', click)
    createNativeTaskNotifications(() => 'zh-CN').show('input-required', click)
    expect(state.options).toEqual([
      { title: 'PiPilot', body: 'A task has completed.', silent: true },
      { title: 'PiPilot', body: '一项任务需要你处理。', silent: true },
    ])
    state.clicks[0]()
    expect(click).toHaveBeenCalledOnce()
  })
})
