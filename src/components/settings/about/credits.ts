import type { MessageKey } from '@/i18n'

/** Curated contributions, not a substitute for the build's complete license manifest. */
export const CREDITS: readonly { name: string; role: MessageKey; license: string; url: string }[] = [
  { name: 'Pi', role: 'settings.about.credit.pi', license: 'MIT', url: 'https://github.com/earendil-works/pi' },
  { name: 'Electron', role: 'settings.about.credit.electron', license: 'MIT', url: 'https://www.electronjs.org' },
  { name: 'React', role: 'settings.about.credit.react', license: 'MIT', url: 'https://react.dev' },
  { name: 'Radix UI', role: 'settings.about.credit.radix', license: 'MIT', url: 'https://www.radix-ui.com' },
  { name: 'Tailwind CSS', role: 'settings.about.credit.tailwind', license: 'MIT', url: 'https://tailwindcss.com' },
  { name: 'Tiptap', role: 'settings.about.credit.tiptap', license: 'MIT', url: 'https://tiptap.dev' },
  { name: 'xterm.js · node-pty', role: 'settings.about.credit.terminal', license: 'MIT', url: 'https://xtermjs.org' },
  { name: 'Pierre Diffs', role: 'settings.about.credit.diffs', license: 'Apache-2.0', url: 'https://diffs.com' },
  { name: 'Shiki · highlight.js', role: 'settings.about.credit.highlight', license: 'MIT · BSD-3-Clause', url: 'https://shiki.style' },
  { name: 'react-markdown', role: 'settings.about.credit.markdown', license: 'MIT', url: 'https://github.com/remarkjs/react-markdown' },
  { name: 'Motion', role: 'settings.about.credit.motion', license: 'MIT', url: 'https://motion.dev' },
  { name: 'Model Context Protocol SDK', role: 'settings.about.credit.mcp', license: 'Apache-2.0', url: 'https://modelcontextprotocol.io' },
  { name: 'Tabler Icons', role: 'settings.about.credit.tabler', license: 'MIT', url: 'https://tabler.io/icons' },
  { name: 'Material Icon Theme', role: 'settings.about.credit.materialIcons', license: 'MIT', url: 'https://github.com/material-extensions/vscode-material-icon-theme' },
  { name: 'LobeHub Icons', role: 'settings.about.credit.lobeIcons', license: 'MIT', url: 'https://github.com/lobehub/lobe-icons' },
  { name: 'models.dev', role: 'settings.about.credit.modelsDev', license: 'MIT', url: 'https://models.dev' },
  { name: 'cc-switch', role: 'settings.about.credit.ccSwitch', license: 'MIT', url: 'https://github.com/farion1231/cc-switch' },
]
