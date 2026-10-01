import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Built to dist/ and served by the Bun server under /employee-master/
// (direct port AND gateway route). Vite dev proxies the prefixed API to
// the Bun API server on 8018, stripping the mount prefix.
export default defineConfig({
  plugins: [react()],
  base: '/employee-master/',
  root: '.',
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      '/employee-master/api': {
        target: 'http://127.0.0.1:8018',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/employee-master/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:8018',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
