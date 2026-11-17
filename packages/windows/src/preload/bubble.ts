import { contextBridge, ipcRenderer } from 'electron'
import type { BubbleAction, BubbleHover } from '../shared/ipc'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const BUBBLE_ACTION = 'bubble:action'
const BUBBLE_HOVER = 'bubble:hover'

contextBridge.exposeInMainWorld('instantBubble', {
  act: (action: BubbleAction) => ipcRenderer.send(BUBBLE_ACTION, action),
  hover: (hover: BubbleHover) => ipcRenderer.send(BUBBLE_HOVER, hover)
})
