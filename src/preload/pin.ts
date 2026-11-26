import { contextBridge, ipcRenderer } from 'electron'
import type { PinEvent, PinView } from '../shared/ipc'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const PIN_STATE = 'pin:state'
const PIN_EVENT = 'pin:event'

contextBridge.exposeInMainWorld('instantPin', {
  send: (event: PinEvent) => ipcRenderer.send(PIN_EVENT, event),
  onState: (callback: (view: PinView) => void) => {
    ipcRenderer.on(PIN_STATE, (_event, view: PinView) => callback(view))
  }
})
