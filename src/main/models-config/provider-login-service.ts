import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent'
import { providerLoginEventSchema, type ProviderLoginEvent, type ProviderLoginPrompt } from '../../shared/provider-login'
import type { BuiltinProvider } from '../../shared/models-config'

type Interaction = Parameters<ModelRuntime['login']>[2]
type PromptRequest = Parameters<Interaction['prompt']>[0]

export class ProviderLoginError extends Error {
  readonly code = 'PROVIDER_LOGIN_FAILED'
}

interface Login {
  id: string
  controller: AbortController
  prompts: Map<string, { resolve(value: string): void; reject(error: Error): void }>
}

function webUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function clip(value: string | undefined, max = 4_000) {
  return value === undefined ? undefined : value.slice(0, max)
}

function promptFor(request: PromptRequest): ProviderLoginPrompt {
  if (request.type === 'select') {
    return { type: 'select', message: clip(request.message)!, options: request.options.slice(0, 20).map((option) => ({
      id: option.id.slice(0, 256), label: option.label.slice(0, 512), ...(option.description ? { description: option.description.slice(0, 1_000) } : {}),
    })) }
  }
  return { type: request.type, message: clip(request.message)!, ...(request.placeholder ? { placeholder: request.placeholder.slice(0, 256) } : {}) }
}

/**
 * Pi's subscription sign-in for its own providers, run in Main so the browser
 * callback, device code and pasted-code steps can go back and forth with the
 * renderer. Pi stores the credential in auth.json, replacing a stored key.
 */
export class ProviderLoginService {
  private active: Login | null = null
  private readonly listeners = new Set<(event: ProviderLoginEvent) => void>()

  constructor(private readonly options: {
    agentDir: string
    openExternal(url: string): Promise<void>
    refreshAuth(): Promise<{ providers: BuiltinProvider[]; apply: Extract<ProviderLoginEvent, { type: 'finished' }>['apply'] }>
  }) {}

  subscribe(listener: (event: ProviderLoginEvent) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(providerId: string) {
    // One sign-in at a time: a second one would fight over the callback port.
    if (this.active) this.cancel(this.active.id)
    const runtime = await ModelRuntime.create({
      authPath: join(this.options.agentDir, 'auth.json'),
      modelsPath: join(this.options.agentDir, 'models.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const provider = runtime.getProvider(providerId)
    if (!provider?.auth.oauth) throw new ProviderLoginError(`${provider?.name ?? providerId} has no subscription sign-in.`)
    const login: Login = { id: randomUUID(), controller: new AbortController(), prompts: new Map() }
    this.active = login
    const settings = SettingsManager.create(this.options.agentDir, this.options.agentDir, { projectTrusted: false })
    void runtime.login(providerId, 'oauth', this.interaction(login), {
      getDeviceId: () => settings.getOrCreateDeviceId(),
      agentName: 'PiPilot',
    }).then(async () => {
      if (this.active !== login) return
      this.active = null
      const { providers, apply } = await this.options.refreshAuth().catch(() => ({ providers: [] as BuiltinProvider[], apply: 'failed' as const }))
      this.emit({ type: 'finished', loginId: login.id, providers, apply })
    }, (error: unknown) => {
      if (this.active === login) this.active = null
      if (login.controller.signal.aborted) {
        this.emit({ type: 'cancelled', loginId: login.id })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'failed', loginId: login.id, code: /EADDRINUSE|address already in use|port .* (?:in use|busy)/iu.test(message) ? 'PORT_IN_USE' : 'FAILED', message: message.slice(0, 1_000) || 'Sign-in failed.' })
    })
    return { loginId: login.id }
  }

  respond(loginId: string, promptId: string, value: string) {
    const pending = this.active?.id === loginId ? this.active.prompts.get(promptId) : undefined
    if (!pending) throw new ProviderLoginError('This sign-in step is no longer waiting for an answer.')
    this.active!.prompts.delete(promptId)
    pending.resolve(value)
  }

  cancel(loginId: string) {
    const login = this.active
    if (!login || login.id !== loginId) return
    login.controller.abort()
    for (const [, pending] of login.prompts) pending.reject(new Error('Sign-in cancelled.'))
    login.prompts.clear()
  }

  dispose() {
    if (this.active) this.cancel(this.active.id)
    this.listeners.clear()
  }

  private interaction(login: Login): Interaction {
    return {
      signal: login.controller.signal,
      prompt: (request) => new Promise<string>((resolve, reject) => {
        const promptId = randomUUID()
        const close = () => {
          if (!login.prompts.delete(promptId)) return
          this.emit({ type: 'prompt_closed', loginId: login.id, promptId })
          reject(new Error('Sign-in step cancelled.'))
        }
        if (request.signal?.aborted || login.controller.signal.aborted) { reject(new Error('Sign-in cancelled.')); return }
        login.prompts.set(promptId, {
          resolve: (value) => { request.signal?.removeEventListener('abort', close); resolve(value) },
          reject: (error) => { request.signal?.removeEventListener('abort', close); reject(error) },
        })
        // A callback that arrives on its own closes the "paste the code" question.
        request.signal?.addEventListener('abort', close, { once: true })
        this.emit({ type: 'prompt', loginId: login.id, promptId, prompt: promptFor(request) })
      }),
      notify: (event) => {
        if (this.active !== login) return
        if (event.type === 'auth_url' || event.type === 'device_code') {
          const url = webUrl(event.type === 'auth_url' ? event.url : event.verificationUri)
          if (!url) return
          void this.options.openExternal(url).catch(() => undefined)
          this.emit(event.type === 'auth_url'
            ? { type: 'auth_url', loginId: login.id, url, ...(event.instructions ? { instructions: clip(event.instructions) } : {}) }
            : { type: 'device_code', loginId: login.id, userCode: event.userCode.slice(0, 64), verificationUri: url,
              ...(event.expiresInSeconds && event.expiresInSeconds > 0 ? { expiresInSeconds: Math.round(event.expiresInSeconds) } : {}) })
        } else if (event.type === 'info') {
          const links = (event.links ?? []).flatMap((link) => { const url = webUrl(link.url); return url ? [{ url, ...(link.label ? { label: link.label.slice(0, 256) } : {}) }] : [] }).slice(0, 5)
          this.emit({ type: 'info', loginId: login.id, message: clip(event.message)!, ...(links.length ? { links } : {}) })
        } else this.emit({ type: 'progress', loginId: login.id, message: clip(event.message)! })
      },
    }
  }

  private emit(event: ProviderLoginEvent) {
    const parsed = providerLoginEventSchema.safeParse(event)
    if (!parsed.success) return
    for (const listener of this.listeners) {
      try { listener(parsed.data) } catch { /* isolate observers */ }
    }
  }
}
