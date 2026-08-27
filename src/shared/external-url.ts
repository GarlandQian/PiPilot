export const MAX_EXTERNAL_URL_LENGTH = 2_048

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function isSafeExternalUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH) return false

  try {
    const parsed = new URL(value)
    return (
      EXTERNAL_PROTOCOLS.has(parsed.protocol) &&
      parsed.hostname !== '' &&
      parsed.username === '' &&
      parsed.password === ''
    )
  } catch {
    return false
  }
}
