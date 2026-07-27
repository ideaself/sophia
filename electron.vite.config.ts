import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

function removeCrossoriginPlugin(): Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/\s*crossorigin\s*/gi, '')
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), removeCrossoriginPlugin()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Split heavy vendor stacks out of the entry chunk so the app
            // shell can render before the markdown/math/highlighter code
            // finishes parsing.
            'vendor-react': ['react', 'react-dom'],
            'vendor-markdown': [
              'react-markdown',
              'remark-gfm',
              'remark-math',
              'rehype-katex',
              'rehype-highlight',
              'katex'
            ]
          }
        }
      }
    }
  }
})
