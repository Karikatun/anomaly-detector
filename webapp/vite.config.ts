import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { validateWebappReleaseEnvironment } from './release-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const environmentDirectory = process.env.LOCAL_MVP_ENV_DIR ?? __dirname
  const environment = loadEnv(mode, environmentDirectory, '')
  if (command === 'build' && environment.WEBAPP_RELEASE_BUILD === 'true') {
    validateWebappReleaseEnvironment(environment)
  }

  return {
    envDir: environmentDirectory,
    server: {
      host: '0.0.0.0',
      headers: {
        'Referrer-Policy': 'no-referrer',
      },
    },
    preview: {
      headers: {
        'Referrer-Policy': 'no-referrer',
      },
    },
    build: {
      ...(process.env.SPLIT_DOMAIN_BUILD_OUT_DIR
        ? { outDir: process.env.SPLIT_DOMAIN_BUILD_OUT_DIR }
        : {}),
      rolldownOptions: {
        output: {
          strictExecutionOrder: true,
          codeSplitting: {
            groups: [
              {
                name: 'react-vendor',
                test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: 'tanstack-vendor',
                test: /node_modules[\\/]@tanstack[\\/]/,
                priority: 20,
              },
              {
                name: 'vendor',
                test: /node_modules/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
  }
})
