// A stand-in for another app that holds a global key (on the Windows test PC another app held Control+Alt+Space, the first default).
// tests/smoke/hotkey.spec.ts starts it as its own Electron process and registers the key through Playwright.
const { app } = require('electron')
app.on('window-all-closed', () => {})
