;(function applyInitialTheme() {
  try {
    const raw = localStorage.getItem('pipilot.settings.v1')
    const theme = raw ? JSON.parse(raw).appearance.theme : 'system'
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  } catch {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark')
    }
  }
})()
