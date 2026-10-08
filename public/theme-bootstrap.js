;(function applyInitialTheme() {
  const root = document.documentElement
  // macOS gets native window chrome (inset traffic lights + sidebar vibrancy).
  root.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'darwin' : 'other'
  // macOS shows always-on scrollbars when "Show scroll bars" is Always (or a
  // mouse is attached). Chromium draws those in a dated, wide style, so CSS
  // restyles only that case; overlay scrollbars stay native. The probe opts out
  // of the restyling so a later preference change is still measured.
  const measureScrollbars = () => {
    const probe = document.createElement('div')
    probe.className = 'scrollbar-probe'
    probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
    root.appendChild(probe)
    root.dataset.scrollbars = probe.offsetWidth - probe.clientWidth > 0 ? 'legacy' : 'overlay'
    probe.remove()
  }
  measureScrollbars()
  window.addEventListener('focus', measureScrollbars)
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
