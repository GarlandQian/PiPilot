import * as React from 'react'
import { TbCheck, TbCopy, TbExternalLink, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { BuiltinProvider } from '@/shared/models-config'
import type { ProviderLoginEvent, ProviderLoginPrompt } from '@/shared/provider-login'
import { SecretInput } from '../editor-page'
import { SettingsGroup, SettingsRow, SettingsSheet, StatusText } from '../kit'

type Step =
  | { kind: 'starting' }
  | { kind: 'waiting' }
  | { kind: 'failed'; code: 'PORT_IN_USE' | 'FAILED' | 'START'; message: string }

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  return <Button variant="outline" size="sm" onClick={() => {
    void navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1_500) }, () => undefined)
  }} aria-label={label}>
    {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}{copied ? t('providerLogin.copied') : t('providerLogin.copy')}
  </Button>
}

function PromptForm({ prompt, onSubmit }: { prompt: ProviderLoginPrompt; onSubmit(value: string): void }) {
  const t = useT()
  const [value, setValue] = React.useState('')
  const id = React.useId()
  if (prompt.type === 'select') {
    return <SettingsGroup title={prompt.message} data-provider-login-prompt="select">
      {prompt.options.map((option) => <SettingsRow key={option.id} label={option.label} description={option.description}>
        <Button variant="outline" size="sm" onClick={() => onSubmit(option.id)}>{t('providerLogin.choose')}</Button>
      </SettingsRow>)}
    </SettingsGroup>
  }
  return <form data-provider-login-prompt={prompt.type} className="settings-group space-y-2 px-3.5 py-3" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()) }}>
    <label htmlFor={id} className="block text-app">{prompt.message}</label>
    <div className="flex gap-2">
      {prompt.type === 'secret'
        ? <SecretInput id={id} value={value} onChange={setValue} placeholder={prompt.placeholder} className="min-w-0 flex-1" />
        : <Input id={id} value={value} onChange={(event) => setValue(event.target.value)} placeholder={prompt.placeholder} autoComplete="off" spellCheck={false} className="min-w-0 flex-1 font-mono" />}
      <Button type="submit" size="sm" disabled={!value.trim()}>{t('providerLogin.submit')}</Button>
    </div>
  </form>
}

/**
 * Pi's subscription sign-in, step by step: the browser page it opened, a code
 * to enter on another device, or a question Pi asks (a pasted code, an account
 * choice). Pi stores the result in auth.json.
 */
export function ProviderLoginSheet({ provider, open, onOpenChange, onSignedIn }: {
  provider: BuiltinProvider
  open: boolean
  onOpenChange(open: boolean): void
  onSignedIn(providers: BuiltinProvider[], apply: Extract<ProviderLoginEvent, { type: 'finished' }>['apply']): void
}) {
  const t = useT()
  const api = window.pipilot?.providerLogin
  const [step, setStep] = React.useState<Step>({ kind: 'starting' })
  const [authUrl, setAuthUrl] = React.useState<Extract<ProviderLoginEvent, { type: 'auth_url' }> | null>(null)
  const [device, setDevice] = React.useState<Extract<ProviderLoginEvent, { type: 'device_code' }> | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [prompt, setPrompt] = React.useState<Extract<ProviderLoginEvent, { type: 'prompt' }> | null>(null)
  const loginId = React.useRef<string | null>(null)
  // Events can arrive before start() answers with their login's id.
  const early = React.useRef<ProviderLoginEvent[]>([])
  const callbacks = React.useRef({ onOpenChange, onSignedIn })
  callbacks.current = { onOpenChange, onSignedIn }
  const handle = React.useRef<(event: ProviderLoginEvent) => void>(() => undefined)

  const start = React.useCallback(() => {
    if (!api) { setStep({ kind: 'failed', code: 'START', message: '' }); return }
    setStep({ kind: 'starting' }); setAuthUrl(null); setDevice(null); setMessage(null); setPrompt(null)
    loginId.current = null
    early.current = []
    api.start(provider.id).then(({ loginId: id }) => {
      loginId.current = id
      setStep((current) => current.kind === 'starting' ? { kind: 'waiting' } : current)
      const buffered = early.current.filter((event) => event.loginId === id)
      early.current = []
      for (const event of buffered) handle.current(event)
    }, (error: unknown) => setStep({ kind: 'failed', code: 'START', message: error instanceof Error ? error.message : '' }))
  }, [api, provider.id])

  React.useEffect(() => {
    if (!open || !api) return
    const detach = api.subscribe((event) => {
      if (loginId.current === null) { early.current.push(event); return }
      if (event.loginId === loginId.current) handle.current(event)
    })
    handle.current = (event) => {
      if (event.type === 'auth_url') { setAuthUrl(event); setStep({ kind: 'waiting' }) }
      else if (event.type === 'device_code') { setDevice(event); setStep({ kind: 'waiting' }) }
      else if (event.type === 'info' || event.type === 'progress') setMessage(event.message)
      else if (event.type === 'prompt') { setPrompt(event); setStep({ kind: 'waiting' }) }
      else if (event.type === 'prompt_closed') setPrompt((current) => current?.promptId === event.promptId ? null : current)
      else if (event.type === 'finished') { loginId.current = null; callbacks.current.onSignedIn(event.providers, event.apply); callbacks.current.onOpenChange(false) }
      else if (event.type === 'failed') { loginId.current = null; setPrompt(null); setStep({ kind: 'failed', code: event.code, message: event.message }) }
      else if (event.type === 'cancelled') { loginId.current = null; callbacks.current.onOpenChange(false) }
    }
    start()
    return () => {
      detach()
      // Closing the sheet ends a sign-in that is still waiting.
      if (loginId.current) void api.cancel(loginId.current).catch(() => undefined)
      loginId.current = null
    }
  }, [api, open, start])

  const respond = (value: string) => {
    if (!api || !prompt) return
    const current = prompt
    setPrompt(null)
    void api.respond(current.loginId, current.promptId, value).catch(() => setPrompt(current))
  }
  const openUrl = (url: string) => { void window.pipilot?.shell.openExternal(url).catch(() => undefined) }
  const name = provider.oauthName ?? provider.name

  return <SettingsSheet open={open} onOpenChange={onOpenChange} data-provider-login-sheet={provider.id}
    title={t('providerLogin.title', { name })} description={t('providerLogin.description')}
    footer={<div className="flex items-center justify-end gap-2">
      {step.kind === 'failed' ? <Button variant="outline" size="sm" onClick={start}>{t('common.retry')}</Button> : null}
      <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
    </div>}>
    <div className="space-y-4">
      {step.kind === 'failed' ? <p role="alert" className="rounded-[12px] bg-destructive/8 px-3.5 py-2.5 text-caption whitespace-pre-wrap text-destructive">
        {step.code === 'PORT_IN_USE' ? t('providerLogin.portInUse') : step.message || t('providerLogin.failed')}
      </p> : null}
      {device ? <SettingsGroup title={t('providerLogin.deviceTitle')} footer={t('providerLogin.deviceHint')} data-provider-login-device>
        <div data-settings-row className="flex flex-wrap items-center gap-3 px-3.5 py-3">
          <code className="min-w-0 flex-1 font-mono text-[22px] font-semibold tracking-[0.12em] select-all">{device.userCode}</code>
          <CopyButton value={device.userCode} label={t('providerLogin.copyCode')} />
          <Button size="sm" onClick={() => openUrl(device.verificationUri)}><TbExternalLink aria-hidden />{t('providerLogin.openPage')}</Button>
        </div>
      </SettingsGroup> : null}
      {authUrl ? <SettingsGroup title={t('providerLogin.browserTitle')} footer={authUrl.instructions ?? t('providerLogin.browserHint')} data-provider-login-browser>
        <SettingsRow label={<span className="block truncate font-mono text-caption text-muted-foreground" title={authUrl.url}>{authUrl.url}</span>}>
          <CopyButton value={authUrl.url} label={t('providerLogin.copyLink')} />
          <Button size="sm" onClick={() => openUrl(authUrl.url)}><TbExternalLink aria-hidden />{t('providerLogin.openAgain')}</Button>
        </SettingsRow>
      </SettingsGroup> : null}
      {prompt ? <PromptForm key={prompt.promptId} prompt={prompt.prompt} onSubmit={respond} /> : null}
      {step.kind !== 'failed' && !prompt ? <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
        <TbLoader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        {message ?? t(step.kind === 'starting' ? 'providerLogin.starting' : device ? 'providerLogin.waitingDevice' : 'providerLogin.waiting')}
      </p> : null}
      {provider.credential === 'api_key' ? <StatusText tone="warning">{t('providerLogin.replacesKey')}</StatusText> : null}
    </div>
  </SettingsSheet>
}
