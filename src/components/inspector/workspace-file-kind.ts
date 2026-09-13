/**
 * Renderer-only classification for the already validated workspace preview
 * path. It intentionally has no filesystem or IPC concerns.
 */

export type WorkspaceFileDisplayKind = 'markdown' | 'source' | 'plain'

export interface WorkspaceFileClassification {
  kind: WorkspaceFileDisplayKind
  /** Highlight.js/lowlight language name, when a grammar is available. */
  language?: string
}

const SOURCE_LANGUAGES = new Map(Object.entries({
  '.bash': 'shell',
  '.bat': 'dos',
  '.c': 'c',
  '.cc': 'cpp',
  '.cfg': 'ini',
  '.cjs': 'javascript',
  '.cmd': 'dos',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.cts': 'typescript',
  '.cxx': 'cpp',
  '.diff': 'diff',
  '.env': 'shell',
  '.fish': 'shell',
  '.go': 'go',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.htm': 'xml',
  '.html': 'xml',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.kotlin': 'kotlin',
  '.kts': 'kotlin',
  '.less': 'less',
  '.lua': 'lua',
  '.m': 'objectivec',
  '.make': 'makefile',
  '.mk': 'makefile',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.patch': 'diff',
  '.php': 'php',
  '.pl': 'perl',
  '.pm': 'perl',
  '.properties': 'ini',
  '.ps1': 'powershell',
  '.psd1': 'powershell',
  '.psm1': 'powershell',
  '.py': 'python',
  '.r': 'r',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sass': 'scss',
  '.scala': 'java',
  '.scss': 'scss',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svelte': 'xml',
  '.svg': 'xml',
  '.swift': 'swift',
  '.toml': 'ini',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vb': 'vbnet',
  '.vue': 'xml',
  '.wasm': 'wasm',
  '.xhtml': 'xml',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell',
}))

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkdn', '.mdx'])
const SOURCE_BASENAMES = new Map(Object.entries({
  '.bash_login': 'shell',
  '.bash_profile': 'shell',
  '.bashrc': 'shell',
  '.dockerignore': 'bash',
  '.editorconfig': 'ini',
  '.envrc': 'shell',
  '.gitattributes': 'bash',
  '.gitconfig': 'ini',
  '.gitignore': 'bash',
  '.npmrc': 'ini',
  '.prettierignore': 'bash',
  '.prettierrc': 'json',
  '.profile': 'shell',
  '.yarnrc': 'ini',
  '.zlogin': 'shell',
  '.zprofile': 'shell',
  '.zshenv': 'shell',
  '.zshrc': 'shell',
  'bashrc': 'shell',
  'dockerfile': 'bash',
  'makefile': 'makefile',
  'rakefile': 'ruby',
}))

function basename(path: string) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase()
}

function extension(path: string) {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

export function classifyWorkspaceFile(path: string): WorkspaceFileClassification {
  const name = basename(path)
  const ext = extension(path)
  if (MARKDOWN_EXTENSIONS.has(ext)) return { kind: 'markdown', language: 'markdown' }
  if (name === '.env' || name.startsWith('.env.')) return { kind: 'source', language: 'shell' }

  const language = SOURCE_BASENAMES.get(name) ?? SOURCE_LANGUAGES.get(ext)
  return language ? { kind: 'source', language } : { kind: 'plain' }
}

/** Keep the relative path readable without allowing an unbounded header. */
export function displayWorkspacePath(path: string, maxLength = 120) {
  const limit = Math.max(1, Math.floor(maxLength))
  if (path.length <= limit) return path
  if (limit === 1) return '…'
  const headLength = Math.ceil((limit - 1) / 2)
  const tailLength = limit - headLength - 1
  return `${path.slice(0, headLength)}…${path.slice(-tailLength)}`
}

export function formatWorkspaceFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1_024) return `${Math.floor(bytes)} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`
  if (bytes < 1_024 * 1_024 * 1_024) return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`
  return `${(bytes / (1_024 * 1_024 * 1_024)).toFixed(1)} GiB`
}
