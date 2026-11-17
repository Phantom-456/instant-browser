import { contextBridge, ipcRenderer } from 'electron'
import type { ManagerAction, ManagerView } from '../shared/ipc'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const MANAGER_GET = 'manager:get'
const MANAGER_ACTION = 'manager:action'
const MANAGER_CHANGED = 'manager:changed'

contextBridge.exposeInMainWorld('instantManager', {
  get: (): Promise<ManagerView> => ipcRenderer.invoke(MANAGER_GET),
  action: (action: ManagerAction): Promise<ManagerView> => ipcRenderer.invoke(MANAGER_ACTION, action),
  onChanged: (callback: () => void) => {
    ipcRenderer.on(MANAGER_CHANGED, () => callback())
  }
})
