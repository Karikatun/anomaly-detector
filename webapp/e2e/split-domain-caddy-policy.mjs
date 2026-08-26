export function siteBlock(source, hostname) {
  const match = source.match(
    new RegExp(`^[\\t ]*${escapeRegExp(hostname)}[\\t ]*\\{`, 'm'),
  )
  if (match?.index === undefined) throw new Error(`Missing ${hostname} site block`)
  const start = match.index

  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`Unclosed ${hostname} site block`)
}

export function legacyRouteMatchers(source) {
  const routeLine = source.match(/@legacyPlayerRoutes\s*{\s*path\s+([^\n]+)\s*}/)?.[1]
  if (!routeLine) throw new Error('Missing @legacyPlayerRoutes path matcher')

  return routeLine.trim().split(/\s+/).map((pattern) => {
    const expression = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')
    return new RegExp(`^${expression}$`)
  })
}

export function redirectPolicy(block, matcher) {
  const directives = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('redir '))
  const tokens = directives
    .map((line) => line.split(/\s+/))
    .find((parts) => matcher ? parts[1] === matcher : !parts[1]?.startsWith('@'))

  if (!tokens) {
    throw new Error(`Missing${matcher ? ` ${matcher}` : ''} redirect directive`)
  }

  const destinationIndex = matcher ? 2 : 1
  const destination = tokens[destinationIndex]
  const statusToken = tokens[destinationIndex + 1]
  if (!destination?.endsWith('{uri}')) {
    throw new Error('Redirect must preserve the complete request URI')
  }

  const destinationOrigin = destination.slice(0, -'{uri}'.length)
  if (new URL(destinationOrigin).origin !== destinationOrigin) {
    throw new Error('Redirect destination must be an exact origin')
  }

  const status = redirectStatus(statusToken)
  const cacheControl = matcher
    ? block.match(new RegExp(`(?:^|\\n)\\s*header\\s+${escapeRegExp(matcher)}\\s+Cache-Control\\s+"([^"]+)"`))?.[1]
    : block.match(/(?:^|\n)\s*header\s+Cache-Control\s+"([^"]+)"/)?.[1]

  return { cacheControl, destinationOrigin, status }
}

export function localizeRedirectPolicy(policy, originMap) {
  const destinationOrigin = originMap[policy.destinationOrigin]
  if (!destinationOrigin) {
    throw new Error(`Unrecognized redirect destination ${policy.destinationOrigin}`)
  }
  return { ...policy, destinationOrigin }
}

function redirectStatus(value) {
  if (value === 'permanent') return 301
  if (value === 'temporary') return 302
  if (/^3\d\d$/.test(value ?? '')) return Number(value)
  throw new Error(`Unsupported explicit redirect status ${value ?? '<missing>'}`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
