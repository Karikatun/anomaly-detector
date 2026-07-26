/**
 * Seeds two test users into the database.
 * Run: bun run scripts/seed-test-users.ts
 */

const API = process.env.API_URL ?? 'http://localhost:3000'

interface CookieAuthResponse {
  user: { id: string; displayName: string; login: string }
}

async function registerUser(login: string, password: string, displayName: string): Promise<CookieAuthResponse> {
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:5173' },
    body: JSON.stringify({
      displayName,
      login,
      password,
      privacyConsent: true,
      privacyConsentVersion: '1.0',
      termsVersion: '1.0',
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(`Failed to register ${login}: ${err.error?.message ?? res.statusText}`)
  }
  return res.json()
}

async function main() {
  console.log(`Seeding test users via ${API}...\n`)

  const users = [
    { login: 'player1', password: 'test1234', displayName: 'Игрок 1' },
    { login: 'player2', password: 'test1234', displayName: 'Игрок 2' },
  ]

  for (const user of users) {
    try {
      const result = await registerUser(user.login, user.password, user.displayName)
      console.log(`✓ ${user.displayName}: ${result.user.id} (${result.user.login})`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        console.log(`⚠ ${user.displayName}: already exists, skipping`)
      } else {
        console.error(`✗ ${user.displayName}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
