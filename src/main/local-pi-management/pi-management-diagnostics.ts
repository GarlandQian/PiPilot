import { basename } from 'node:path'
import { PI_INTEGRATION_MESSAGE_LIMIT } from '../../shared/pi-integrations'

const SECRET_KEY = String.raw`(?:_authToken|_auth|_password|authorization|api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|credentials?)`
// An auth scheme ("Bearer", "Basic", "token") is part of the secret value, not a separator.
const SECRET_VALUE = String.raw`(?:(?:bearer|basic|token)\s+)?(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&"']+)`
const KEYED_SECRET = new RegExp(String.raw`(${SECRET_KEY}["']?\s*[=:]\s*)${SECRET_VALUE}`, 'giu')
// `npm config set //registry/:_auth "value"` separates the key with whitespace only.
const NPM_CONFIG_SECRET = /((?:^|[\s/:])(?:_authToken|_auth|_password)\s+)(?:"[^"\n]*"|'[^'\n]*'|\S+)/giu
// Environment assignments such as NPM_TOKEN=… or NODE_AUTH_TOKEN=… (upper-case names only,
// so ordinary prose like "tokens=3" is left alone).
const ENV_SECRET = /(\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|CREDENTIAL|AUTH|_PAT)[A-Z0-9_]*=)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&]+)/gu

/** Package runners can echo private registry credentials in command arguments. */
export function safePiManagementMessage(value: string, packageCommand?: readonly string[]) {
  let message = value
  if (packageCommand?.length) {
    message = message.split(packageCommand.join(' ')).join(basename(packageCommand[0] ?? 'package-manager'))
  }
  return message
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu, '$1[redacted]@')
    .replace(KEYED_SECRET, '$1[redacted]')
    .replace(NPM_CONFIG_SECRET, '$1[redacted]')
    .replace(ENV_SECRET, '$1[redacted]')
    .slice(0, PI_INTEGRATION_MESSAGE_LIMIT)
}
