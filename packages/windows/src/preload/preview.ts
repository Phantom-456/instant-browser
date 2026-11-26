import { contextBridge, ipcRenderer } from 'electron'
import type { PreviewAction, PreviewState } from '../shared/ipc'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const PREVIEW_STATE = 'preview:state'
const PREVIEW_ACTION = 'preview:action'

contextBridge.exposeInMainWorld('instantPreview', {
  act: (action: PreviewAction) => ipcRenderer.send(PREVIEW_ACTION, action),
  onState: (callback: (state: PreviewState) => void) => {
    ipcRenderer.on(PREVIEW_STATE, (_event, state: PreviewState) => callback(state))
  }
})
