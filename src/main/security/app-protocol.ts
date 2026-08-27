import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { resolveAppProtocolPath } from './app-protocol-path'
import { APP_SCHEME } from './url-policy'

export function registerAppSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        codeCache: true,
        secure: true,
        standard: true,
        supportFetchAPI: true,
      },
    },
  ])
}

export function registerAppProtocol(rendererRoot: string) {
  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveAppProtocolPath(rendererRoot, request.url)
    if (!filePath) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}
