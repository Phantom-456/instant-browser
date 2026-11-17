import { contextBridge, ipcRenderer } from 'electron'
import type { BarResults } from '../shared/ipc'

// A sandboxed preload cannot load other files, so the channel names are written here.
// tests/unit/preloadChannels.test.ts checks that they match src/shared/ipc.ts.
const SEARCH_SUBMIT = 'search:submit'
const SEARCH_CANCEL = 'search:cancel'
const SEARCH_SHOW = 'search:show'
const SEARCH_SUGGEST = 'search:suggest'
const SEARCH_RESIZE = 'search:resize'
const SEARCH_QUERY = 'search:query'
const SEARCH_OPEN_SETTINGS = 'search:open-settings'
const SEARCH_OPEN_MANAGER = 'search:open-manager'
const SEARCH_HISTORY_CHANGED = 'search:history-changed'

contextBridge.exposeInMainWorld('instantSearch', {
  submit: (text: string) => ipcRenderer.send(SEARCH_SUBMIT, text),
  cancel: () => ipcRenderer.send(SEARCH_CANCEL),
  suggest: (text: string): Promise<string[]> => ipcRenderer.invoke(SEARCH_SUGGEST, text),
  resize: (height: number) => ipcRenderer.send(SEARCH_RESIZE, height),
  query: (text: string): Promise<BarResults> => ipcRenderer.invoke(SEARCH_QUERY, text),
  openSettings: (section: string) => ipcRenderer.send(SEARCH_OPEN_SETTINGS, section),
  openManager: () => ipcRenderer.send(SEARCH_OPEN_MANAGER),
  onHistoryChanged: (callback: () => void) => {
    ipcRenderer.on(SEARCH_HISTORY_CHANGED, () => callback())
  },
  onShow: (callback: () => void) => {
    ipcRenderer.on(SEARCH_SHOW, () => callback())
  }
})
