const passwordHashPolicy = {
  memoryCost: 65_536,
  parallelism: 1,
  timeCost: 2,
  version: 19,
} as const

const invalidPasswordFallbackHash =
  '$argon2id$v=19$m=65536,t=2,p=1$POtlkAZkJ6MESoUj6hp8X7wL+1nupU1zyt2DDsyj7k0$EoTM08qhB7JueGAIA3VrvrFHkJGNlWrYVWHOmgoGdwE'

export function hashPassword(password: string) {
  return Bun.password.hash(password, {
    algorithm: 'argon2id',
    memoryCost: passwordHashPolicy.memoryCost,
    timeCost: passwordHashPolicy.timeCost,
  })
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null | undefined,
) {
  if (!passwordHash) {
    await Bun.password.verify(password, invalidPasswordFallbackHash)
    return false
  }

  try {
    return await Bun.password.verify(password, passwordHash)
  } catch {
    await Bun.password.verify(password, invalidPasswordFallbackHash)
    return false
  }
}

export function passwordHashNeedsRehash(passwordHash: string) {
  const parameters = parseArgon2idParameters(passwordHash)
  return parameters === null
    || parameters.version !== passwordHashPolicy.version
    || parameters.memoryCost < passwordHashPolicy.memoryCost
    || parameters.timeCost < passwordHashPolicy.timeCost
    || parameters.parallelism !== passwordHashPolicy.parallelism
}

function parseArgon2idParameters(passwordHash: string) {
  const match = passwordHash.match(
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/,
  )
  if (!match) return null

  return {
    version: Number(match[1]),
    memoryCost: Number(match[2]),
    timeCost: Number(match[3]),
    parallelism: Number(match[4]),
  }
}
