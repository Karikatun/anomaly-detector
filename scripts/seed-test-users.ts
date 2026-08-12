/**
 * Creates or verifies the two stable local browser-audit users.
 * Run: bun run seed:test-users
 */

const API = process.env.API_URL ?? 'http://localhost:3000'

interface TokenAuthResponse {
  user: { id: string; displayName: string; login: string }
}

type ApiError = {
  error?: {
    code?: string
    message?: string
  }
}

async function request(path: string, body: object) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function registerOrVerify(
  login: string,
  password: string,
  displayName: string,
): Promise<{ result: TokenAuthResponse; status: 'created' | 'verified' }> {
  const registration = await request('/api/auth/token/register', {
    displayName,
    login,
    password,
    privacyConsent: true,
    privacyConsentVersion: '1.0',
    termsAccepted: true,
    termsVersion: '1.0',
  })
  if (registration.ok) {
    return { result: await registration.json() as TokenAuthResponse, status: 'created' }
  }

  const registrationError = await registration.json().catch(() => ({})) as ApiError
  if (registration.status !== 409 || registrationError.error?.code !== 'CONFLICT') {
    throw new Error(
      `Не удалось создать ${login}: ${registrationError.error?.message ?? registration.statusText}`,
    )
  }

  const loginResponse = await request('/api/auth/token/login', { login, password })
  if (!loginResponse.ok) {
    const loginError = await loginResponse.json().catch(() => ({})) as ApiError
    throw new Error(
      `Пользователь ${login} уже существует, но пароль не совпадает: `
      + `${loginError.error?.message ?? loginResponse.statusText}`,
    )
  }

  return {
    result: await loginResponse.json() as TokenAuthResponse,
    status: 'verified',
  }
}

async function main() {
  console.log(`Подготовка локальных тестовых пользователей через ${API}...`)

  const users = [
    { login: 'testPlayer1', password: 'test1234', displayName: 'Тестовый игрок 1' },
    { login: 'testPlayer2', password: 'test1234', displayName: 'Тестовый игрок 2' },
  ]

  for (const user of users) {
    const { result, status } = await registerOrVerify(user.login, user.password, user.displayName)
    const statusLabel = status === 'created' ? 'создан' : 'проверен'
    console.log(`✓ ${result.user.login}: ${statusLabel}`)
  }

  console.log('Готово.')
}

main().catch((err) => {
  console.error('Подготовка пользователей завершилась ошибкой:', err)
  process.exit(1)
})
