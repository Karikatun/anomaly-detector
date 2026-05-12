import 'dotenv/config'

import { createApp } from './app'
import { createPrisma } from './db'
import { loadEnv } from './env'

const env = loadEnv(Bun.env)
const prisma = createPrisma(env.DATABASE_URL)
const app = createApp({ env, prisma })

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
})

console.log(`Backend listening on ${server.url}`)
