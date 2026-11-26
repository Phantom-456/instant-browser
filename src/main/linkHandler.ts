import { app } from 'electron'
import { urlsFromArgv } from '../shared/browserCommands'
import { isAllowedUrl } from '../shared/urlPolicy'

/**
 * Open links that other apps hand to us.
 * Mac sends an 'open-url' event. Windows starts a second copy with the URL as an argument.
 * Call this before app.whenReady(): Mac can send 'open-url' very early.
 * Links wait in a queue until the returned start() is called, after the mini window manager exists.
 */
export function installLinkHandler(open: (url: string) => void): () => void {
  const waiting: string[] = []
  let ready = false
  const deliver = (url: string) => {
    if (!isAllowedUrl(url)) return
    if (ready) open(url)
    else waiting.push(url)
  }

  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliver(url)
  })
  // The app is listed as a viewer of HTML files (macOS needs that to show it as a browser). Local files are not web pages, so they are ignored.
  app.on('open-file', (event) => event.preventDefault())
  app.on('second-instance', (_event, argv) => {
    for (const url of urlsFromArgv(argv)) deliver(url)
  })
  for (const url of urlsFromArgv(process.argv.slice(1))) deliver(url)

  return () => {
    ready = true
    for (const url of waiting.splice(0)) open(url)
  }
}
