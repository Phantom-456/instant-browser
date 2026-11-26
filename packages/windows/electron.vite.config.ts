import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          search: resolve(__dirname, 'src/preload/search.ts'),
          toolbar: resolve(__dirname, 'src/preload/toolbar.ts'),
          settings: resolve(__dirname, 'src/preload/settings.ts'),
          pin: resolve(__dirname, 'src/preload/pin.ts'),
          preview: resolve(__dirname, 'src/preload/preview.ts'),
          manager: resolve(__dirname, 'src/preload/manager.ts'),
          bubble: resolve(__dirname, 'src/preload/bubble.ts'),
          page: resolve(__dirname, 'src/preload/page.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          search: resolve(__dirname, 'src/renderer/search/index.html'),
          toolbar: resolve(__dirname, 'src/renderer/toolbar/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          pin: resolve(__dirname, 'src/renderer/pin/index.html'),
          preview: resolve(__dirname, 'src/renderer/preview/index.html'),
          manager: resolve(__dirname, 'src/renderer/manager/index.html'),
          bubble: resolve(__dirname, 'src/renderer/bubble/index.html')
        }
      }
    }
  }
})
