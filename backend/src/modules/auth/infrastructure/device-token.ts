import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import type { DeviceTokens } from '../application/ports'

export function createDeviceTokens(secret: string): DeviceTokens {
  return {
    resolve(value) {
      const existingId = value ? verifyDeviceToken(value, secret) : null
      if (existingId) return { deviceId: existingId, cookieValue: null }

      const deviceId = randomBytes(32).toString('base64url')
      return {
        deviceId,
        cookieValue: `${deviceId}.${sign(deviceId, secret)}`,
      }
    },
  }
}

function verifyDeviceToken(value: string, secret: string) {
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const deviceId = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  const expected = sign(deviceId, secret)
  const signatureBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)
  if (
    signatureBytes.length !== expectedBytes.length
    || !timingSafeEqual(signatureBytes, expectedBytes)
  ) return null
  return deviceId
}

function sign(deviceId: string, secret: string) {
  return createHmac('sha256', secret)
    .update(`auth-device:${deviceId}`)
    .digest('base64url')
}
