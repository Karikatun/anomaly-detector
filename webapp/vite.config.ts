import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, __dirname, '')
  if (command === 'build' && environment.LEGAL_DOCUMENTS_CONFIGURED === 'true') {
    for (const name of [
      'VITE_PUBLIC_LEGAL_OPERATOR_NAME',
      'VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT',
      'VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS',
      'VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE',
    ]) {
      if (!environment[name]?.trim()) throw new Error(`${name} must be set for a public webapp build`)
    }
  }

  return {
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
