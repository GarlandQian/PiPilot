;(function applyInitialTheme() {
  const root = document.documentElement
  // macOS gets native window chrome (inset traffic lights + sidebar vibrancy).
  root.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'darwin' : 'other'
  try {
    const raw = localStorage.getItem('pipilot.settings.v1')
    const appearance = raw ? JSON.parse(raw).appearance : undefined
    const theme = appearance ? appearance.theme : 'system'
    if (appearance && Number.isInteger(appearance.glassTint)) {
      root.style.setProperty('--glass-tint', String(Math.min(100, Math.max(0, appearance.glassTint)) / 100))
    }
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.classList.toggle('dark', dark)
  } catch {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark')
    }
  }
})()
