import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { staticArtifactGuard } from '../scripts/static-artifacts.mjs'

export default defineConfig({
  plugins: [react(), staticArtifactGuard()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000' },
    },
    strictPort: true,
  },
})
