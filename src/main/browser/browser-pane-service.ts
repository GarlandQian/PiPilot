import { randomUUID } from 'node:crypto'
import { WebContentsView, session as electronSession, shell, type BrowserWindow, type Session, type WebContents } from 'electron'
import type { BrowserAnnotation, BrowserBounds, BrowserCommand, BrowserSnapshot, BrowserTab } from '../../shared/browser-pane'

export class BrowserPaneError extends Error {
  readonly code = 'BROWSER_FAILED'
}

const PARTITION = 'persist:pipilot-browser'
const MAX_TABS = 12
const MAX_LOG = 50

interface Tab {
  id: string
  view: WebContentsView
  failure?: { code: number; description: string }
  console: string[]
  network: string[]
  annotating: boolean
}

interface Scope { tabs: Tab[]; activeId: string | null }

/** Turns what was typed into the address bar into a web address. */
export function browserAddress(input: string) {
  const value = input.trim()
  if (!value) throw new BrowserPaneError('Enter an address.')
  if (/^https?:\/\//iu.test(value)) return new URL(value).toString()
  if (/^about:blank$/iu.test(value)) return 'about:blank'
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) && !/^(?:localhost|[\w.-]+):\d+/iu.test(value)) throw new BrowserPaneError('Only web addresses (http and https) open here.')
  const local = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/iu.test(value)
  const host = /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/u.test(value) || /^[\w.-]+:\d+(?:[/?#]|$)/u.test(value)
  if (local) return new URL(`http://${value.replace(/^0\.0\.0\.0/u, 'localhost')}`).toString()
  if (host && !/\s/u.test(value)) return new URL(`https://${value}`).toString()
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

function allowedNavigation(url: string) {
  return /^(?:https?:|about:blank)/iu.test(url)
}

/**
 * Injected into the page for an annotation; resolves with what was picked (or
 * null). Plain JavaScript source, so no bundler helper can leak into the page.
 */
const ANNOTATION_SCRIPT = String.raw`(mode) => new Promise((resolve) => {
  const doc = document
  const root = doc.createElement('div')
  root.setAttribute('data-pipilot-annotation', '')
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:transparent;'
  const box = doc.createElement('div')
  box.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #0a84ff;background:rgba(10,132,255,.14);border-radius:4px;display:none;box-sizing:border-box;'
  root.appendChild(box)
  doc.documentElement.appendChild(root)
  const done = (value) => {
    root.remove()
    removeEventListener('keydown', onKey, true)
    delete window.__pipilotAnnotationCancel
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)))
  }
  const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); done(null) } }
  addEventListener('keydown', onKey, true)
  window.__pipilotAnnotationCancel = () => done(null)
  const show = (rect) => {
    box.style.display = 'block'
    box.style.left = rect.left + 'px'; box.style.top = rect.top + 'px'
    box.style.width = rect.width + 'px'; box.style.height = rect.height + 'px'
  }
  const under = (x, y) => {
    root.style.pointerEvents = 'none'
    const element = doc.elementFromPoint(x, y)
    root.style.pointerEvents = 'auto'
    return element
  }
  const selectorOf = (element) => {
    const parts = []
    let current = element
    while (current && current !== doc.documentElement && parts.length < 5) {
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break }
      let part = current.tagName.toLowerCase()
      const classes = [...current.classList].filter((name) => !/^[a-z]{1,3}-[\w-]{5,}$/.test(name)).slice(0, 2)
      if (classes.length) part += classes.map((name) => '.' + CSS.escape(name)).join('')
      const parent = current.parentElement
      if (parent) {
        const same = [...parent.children].filter((child) => child.tagName === current.tagName)
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(current) + 1) + ')'
      }
      parts.unshift(part)
      current = parent
    }
    return parts.join(' > ')
  }
  const KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'gap', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'border', 'border-radius', 'box-shadow', 'opacity']
  if (mode === 'element') {
    let current = null
    root.addEventListener('mousemove', (event) => {
      const element = under(event.clientX, event.clientY)
      if (element && element !== current) { current = element; show(element.getBoundingClientRect()) }
    })
    root.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation()
      const element = current || under(event.clientX, event.clientY)
      if (!element) { done(null); return }
      const rect = element.getBoundingClientRect()
      const computed = getComputedStyle(element)
      const styles = {}
      for (const key of KEYS) { const value = computed.getPropertyValue(key); if (value && value !== 'none' && value !== 'normal' && value !== '0px') styles[key] = value.slice(0, 256) }
      const text = element.innerText ? element.innerText.trim().slice(0, 2000) : ''
      done({ kind: 'element', selector: selectorOf(element).slice(0, 2048), html: element.outerHTML.slice(0, 8000), text: text || undefined, styles,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })
    }, true)
  } else {
    let start = null
    const rectFrom = (event) => ({
      left: Math.min(start.x, event.clientX), top: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y),
    })
    root.addEventListener('mousedown', (event) => { event.preventDefault(); start = { x: event.clientX, y: event.clientY } })
    root.addEventListener('mousemove', (event) => { if (start) show(rectFrom(event)) })
    root.addEventListener('mouseup', (event) => {
      if (!start) return
      const rect = rectFrom(event)
      start = null
      if (rect.width < 6 || rect.height < 6) { box.style.display = 'none'; return }
      done({ kind: 'area', rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } })
    })
  }
})`

/**
 * The project browser: tabs drawn by Main over the renderer's Browser tab, in
 * a session of their own (no PiPilot cookies, permissions or preload). Each
 * project, and general chats, keep their own tabs.
 */
export class BrowserPaneService {
  private readonly scopes = new Map<string, Scope>()
  private readonly listeners = new Set<(snapshot: BrowserSnapshot) => void>()
  private attached: { scopeKey: string; tabId: string; view: WebContentsView } | null = null
  private browserSession: Session | null = null
  private disposed = false

  constructor(private readonly options: {
    getMainWindow(): BrowserWindow | null
    /** A local address the scope's running project action printed. */
    suggestedUrl(scopeKey: string): Promise<string | undefined>
  }) {}

  subscribe(listener: (snapshot: BrowserSnapshot) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async snapshot(scopeKey: string): Promise<BrowserSnapshot> {
    const scope = this.scopes.get(scopeKey)
    const suggestedUrl = await this.options.suggestedUrl(scopeKey).catch(() => undefined)
    return {
      scopeKey,
      tabs: (scope?.tabs ?? []).map((tab) => this.describe(tab)),
      activeId: scope?.activeId ?? null,
      ...(suggestedUrl ? { suggestedUrl } : {}),
    }
  }

  async open(scopeKey: string, url?: string) {
    const scope = this.scope(scopeKey)
    if (scope.tabs.length >= MAX_TABS) throw new BrowserPaneError('Close a browser tab before opening another.')
    const target = url ? browserAddress(url) : await this.options.suggestedUrl(scopeKey).catch(() => undefined) ?? 'about:blank'
    const tab = this.createTab(scopeKey)
    scope.tabs.push(tab)
    scope.activeId = tab.id
    this.reattach(scopeKey)
    void tab.view.webContents.loadURL(target).catch(() => undefined)
    return this.publish(scopeKey)
  }

  async navigate(scopeKey: string, tabId: string, input: string) {
    const tab = this.tab(scopeKey, tabId)
    const url = browserAddress(input)
    tab.failure = undefined
    void tab.view.webContents.loadURL(url).catch(() => undefined)
    return this.publish(scopeKey)
  }

  async command(scopeKey: string, tabId: string, command: BrowserCommand) {
    const scope = this.scope(scopeKey)
    const tab = this.tab(scopeKey, tabId)
    const contents = tab.view.webContents
    const history = contents.navigationHistory
    if (command === 'back' && history.canGoBack()) history.goBack()
    else if (command === 'forward' && history.canGoForward()) history.goForward()
    else if (command === 'reload') { tab.failure = undefined; contents.reload() }
    else if (command === 'stop') contents.stop()
    else if (command === 'external') {
      const url = contents.getURL()
      if (/^https?:/iu.test(url)) await shell.openExternal(url)
    } else if (command === 'devtools') contents.openDevTools({ mode: 'detach' })
    else if (command === 'select') { scope.activeId = tab.id; this.reattach(scopeKey) }
    else if (command === 'close') {
      const index = scope.tabs.indexOf(tab)
      scope.tabs.splice(index, 1)
      if (scope.activeId === tab.id) scope.activeId = scope.tabs[Math.min(index, scope.tabs.length - 1)]?.id ?? null
      if (this.attached?.tabId === tab.id) this.detach()
      contents.close()
      this.reattach(scopeKey)
    }
    return this.publish(scopeKey)
  }

  /** Puts the scope's active tab over `bounds`, or takes it down (with a picture for the placeholder). */
  async setViewport(scopeKey: string, bounds: BrowserBounds | null): Promise<{ placeholder?: string }> {
    const window = this.options.getMainWindow()
    if (!window || window.isDestroyed()) return {}
    if (!bounds || bounds.width < 2 || bounds.height < 2) {
      const attached = this.attached
      let placeholder: string | undefined
      if (attached && attached.scopeKey === scopeKey && !attached.view.webContents.isDestroyed()) {
        placeholder = await attached.view.webContents.capturePage().then((image) => image.isEmpty() ? undefined : image.resize({ width: Math.min(image.getSize().width, 1_200) }).toDataURL(), () => undefined)
      }
      if (!attached || attached.scopeKey === scopeKey) this.detach()
      return placeholder ? { placeholder } : {}
    }
    const scope = this.scopes.get(scopeKey)
    const tab = scope?.tabs.find((candidate) => candidate.id === scope.activeId)
    if (!tab) { this.detach(); return {} }
    if (this.attached?.view !== tab.view) {
      this.detach()
      window.contentView.addChildView(tab.view)
      this.attached = { scopeKey, tabId: tab.id, view: tab.view }
    }
    tab.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })
    return {}
  }

  async annotate(scopeKey: string, tabId: string, mode: 'element' | 'area'): Promise<BrowserAnnotation | null> {
    const tab = this.tab(scopeKey, tabId)
    if (tab.annotating) throw new BrowserPaneError('An annotation is already in progress in this tab.')
    const contents = tab.view.webContents
    if (!/^https?:/iu.test(contents.getURL())) throw new BrowserPaneError('Open a web page first.')
    tab.annotating = true
    try {
      contents.focus()
      const picked = await contents.executeJavaScript(`(${ANNOTATION_SCRIPT})(${JSON.stringify(mode)})`, true) as
        null | { kind: 'element' | 'area'; selector?: string; html?: string; text?: string; styles?: Record<string, string>; rect: BrowserBounds }
      if (!picked) return null
      const rect = picked.rect
      const area = { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), width: Math.max(1, Math.ceil(rect.width)), height: Math.max(1, Math.ceil(rect.height)) }
      let image = await contents.capturePage(area)
      if (image.getSize().width > 1_600) image = image.resize({ width: 1_600 })
      return {
        url: contents.getURL().slice(0, 8_192), title: contents.getTitle().slice(0, 1_024), kind: picked.kind,
        ...(picked.selector ? { selector: picked.selector.slice(0, 2_048) } : {}),
        ...(picked.html ? { html: picked.html.slice(0, 8_000) } : {}),
        ...(picked.text ? { text: picked.text.slice(0, 2_000) } : {}),
        ...(picked.styles ? { styles: Object.fromEntries(Object.entries(picked.styles).slice(0, 24).map(([key, value]) => [key.slice(0, 64), String(value).slice(0, 256)])) } : {}),
        rect, screenshot: image.toDataURL(), consoleErrors: tab.console.slice(-20),
      }
    } finally {
      tab.annotating = false
    }
  }

  async cancelAnnotation(scopeKey: string, tabId: string) {
    const tab = this.tab(scopeKey, tabId)
    if (tab.annotating) await tab.view.webContents.executeJavaScript('window.__pipilotAnnotationCancel?.()', true).catch(() => undefined)
  }

  /** For Pi's read-only browser tools: the scope's active tab. */
  activeTab(scopeKey: string) {
    const scope = this.scopes.get(scopeKey)
    const tab = scope?.tabs.find((candidate) => candidate.id === scope.activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return null
    const contents = tab.view.webContents
    return {
      url: contents.getURL(), title: contents.getTitle(), console: [...tab.console], network: [...tab.network],
      ...(tab.failure ? { failure: tab.failure } : {}),
      screenshot: async () => {
        let image = await contents.capturePage()
        if (image.getSize().width > 1_280) image = image.resize({ width: 1_280 })
        return image.toPNG().toString('base64')
      },
    }
  }

  dispose() {
    this.disposed = true
    this.detach()
    for (const scope of this.scopes.values()) for (const tab of scope.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    this.scopes.clear()
    this.listeners.clear()
  }

  private session() {
    if (this.browserSession) return this.browserSession
    const browser = electronSession.fromPartition(PARTITION)
    // No camera, microphone, notifications, location or other permissions.
    browser.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browser.setPermissionCheckHandler(() => false)
    browser.on('will-download', (event) => event.preventDefault())
    const record = (contentsId: number, line: string) => {
      for (const scope of this.scopes.values()) for (const tab of scope.tabs) {
        if (tab.view.webContents.id !== contentsId) continue
        tab.network.push(line.slice(0, 2_000))
        if (tab.network.length > MAX_LOG) tab.network.shift()
        this.schedulePublish(this.scopeKeyOf(tab))
      }
    }
    browser.webRequest.onCompleted((details) => {
      if (details.statusCode >= 400 && details.webContentsId !== undefined) record(details.webContentsId, `${details.statusCode} ${details.method} ${details.url}`)
    })
    browser.webRequest.onErrorOccurred((details) => {
      if (details.webContentsId !== undefined && details.error !== 'net::ERR_ABORTED') record(details.webContentsId, `${details.error} ${details.method} ${details.url}`)
    })
    this.browserSession = browser
    return browser
  }

  private createTab(scopeKey: string): Tab {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session(), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        webviewTag: false, safeDialogs: true, spellcheck: false, navigateOnDragDrop: false,
      },
    })
    view.setBackgroundColor('#ffffff')
    const tab: Tab = { id: randomUUID(), view, console: [], network: [], annotating: false }
    const contents: WebContents = view.webContents
    const update = () => this.schedulePublish(scopeKey)
    contents.setWindowOpenHandler(({ url }) => {
      // Pop-ups become tabs here; everything else stays in the system browser's hands.
      if (allowedNavigation(url) && !this.disposed) void this.open(scopeKey, url).catch(() => undefined)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault() })
    contents.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) event.preventDefault() })
    contents.on('did-start-loading', () => { tab.failure = undefined; update() })
    contents.on('did-stop-loading', update)
    contents.on('did-navigate', () => { tab.console = []; tab.network = []; update() })
    contents.on('did-navigate-in-page', update)
    contents.on('page-title-updated', update)
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { tab.failure = { code, description: description.slice(0, 512) }; update() }
    })
    contents.on('console-message', (event: unknown, legacyLevel?: unknown, legacyMessage?: unknown, line?: unknown, source?: unknown) => {
      const details = event as { level?: unknown; message?: unknown; lineNumber?: unknown; sourceId?: unknown }
      const level = typeof details.level === 'string' ? details.level : legacyLevel === 3 ? 'error' : ''
      if (level !== 'error') return
      const message = typeof details.message === 'string' ? details.message : String(legacyMessage ?? '')
      const where = String(details.sourceId ?? source ?? '')
      tab.console.push(`${message}${where ? ` (${where}:${String(details.lineNumber ?? line ?? '')})` : ''}`.slice(0, 2_000))
      if (tab.console.length > MAX_LOG) tab.console.shift()
      update()
    })
    return tab
  }

  private reattach(scopeKey: string) {
    if (this.attached?.scopeKey !== scopeKey) return
    const scope = this.scopes.get(scopeKey)
    const active = scope?.tabs.find((tab) => tab.id === scope.activeId)
    const window = this.options.getMainWindow()
    if (!active || !window || window.isDestroyed()) { this.detach(); return }
    if (this.attached.view === active.view) return
    const bounds = this.attached.view.getBounds()
    this.detach()
    window.contentView.addChildView(active.view)
    active.view.setBounds(bounds)
    this.attached = { scopeKey, tabId: active.id, view: active.view }
  }

  private detach() {
    const attached = this.attached
    this.attached = null
    const window = this.options.getMainWindow()
    if (attached && window && !window.isDestroyed()) window.contentView.removeChildView(attached.view)
  }

  private describe(tab: Tab): BrowserTab {
    const contents = tab.view.webContents
    const destroyed = contents.isDestroyed()
    return {
      id: tab.id,
      url: destroyed ? '' : contents.getURL().slice(0, 8_192),
      title: destroyed ? '' : contents.getTitle().slice(0, 1_024),
      loading: !destroyed && contents.isLoading(),
      canGoBack: !destroyed && contents.navigationHistory.canGoBack(),
      canGoForward: !destroyed && contents.navigationHistory.canGoForward(),
      consoleErrors: tab.console.length,
      networkErrors: tab.network.length,
      ...(tab.failure ? { failure: tab.failure } : {}),
    }
  }

  private scope(scopeKey: string) {
    let scope = this.scopes.get(scopeKey)
    if (!scope) { scope = { tabs: [], activeId: null }; this.scopes.set(scopeKey, scope) }
    return scope
  }

  private tab(scopeKey: string, tabId: string) {
    const tab = this.scopes.get(scopeKey)?.tabs.find((candidate) => candidate.id === tabId)
    if (!tab || tab.view.webContents.isDestroyed()) throw new BrowserPaneError('This browser tab is closed.')
    return tab
  }

  private scopeKeyOf(tab: Tab) {
    for (const [key, scope] of this.scopes) if (scope.tabs.includes(tab)) return key
    return ''
  }

  private pendingPublish = new Set<string>()
  private schedulePublish(scopeKey: string) {
    if (!scopeKey || this.pendingPublish.has(scopeKey)) return
    this.pendingPublish.add(scopeKey)
    setTimeout(() => { this.pendingPublish.delete(scopeKey); void this.publish(scopeKey) }, 50).unref?.()
  }

  private async publish(scopeKey: string) {
    const snapshot = await this.snapshot(scopeKey)
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* isolate observers */ }
    }
    return snapshot
  }
}
