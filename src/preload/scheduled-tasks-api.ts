import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { scheduledTaskChannels, scheduledTasksGetContract, scheduledTasksRemoveContract, scheduledTasksRunContract, scheduledTasksSaveContract, scheduledTasksSetEnabledContract, scheduledTasksTargetsContract } from '../shared/ipc/scheduled-tasks-contracts'
import { scheduledTasksChangedSchema, type ScheduledTaskInput, type ScheduledTasksSnapshot } from '../shared/scheduled-tasks'

export function createScheduledTasksApi(invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>, createContext: () => RequestContext) {
  return {
    get: () => invoke(scheduledTasksGetContract, { context: createContext() }),
    save: (task: ScheduledTaskInput) => invoke(scheduledTasksSaveContract, { context: createContext(), task }),
    remove: (id: string) => invoke(scheduledTasksRemoveContract, { context: createContext(), id }),
    runNow: (id: string) => invoke(scheduledTasksRunContract, { context: createContext(), id }),
    setEnabled: (id: string, enabled: boolean) => invoke(scheduledTasksSetEnabledContract, { context: createContext(), id, enabled }),
    listTargets: (cursor?: string) => invoke(scheduledTasksTargetsContract, { context: createContext(), input: { cursor, limit: 50 } }),
    subscribe(listener: (snapshot: ScheduledTasksSnapshot) => void) {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = scheduledTasksChangedSchema.safeParse(raw)
        if (parsed.success) { try { listener(parsed.data.snapshot) } catch { /* isolate renderer observers */ } }
      }
      ipcRenderer.on(scheduledTaskChannels.changed, handler)
      return () => ipcRenderer.removeListener(scheduledTaskChannels.changed, handler)
    },
  }
}
