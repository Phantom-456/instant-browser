import { contextBridge, ipcRenderer } from 'electron'
import type { ToolbarAction, ToolbarState } from '../shared/ipc'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const TOOLBAR_ACTION = 'toolbar:action'
const TOOLBAR_STATE = 'toolbar:state'

contextBridge.exposeInMainWorld('instantToolbar', {
  action: (action: ToolbarAction) => ipcRenderer.send(TOOLBAR_ACTION, action),
  onState: (callback: (state: ToolbarState) => void) => {
    ipcRenderer.on(TOOLBAR_STATE, (_event, state: ToolbarState) => callback(state))
  }
})
