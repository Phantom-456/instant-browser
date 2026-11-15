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
          settings: resolve(__dirname, 'src/preload/settings.ts')
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
          settings: resolve(__dirname, 'src/renderer/settings/index.html')
        }
      }
    }
  }
})
