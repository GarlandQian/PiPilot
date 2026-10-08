import type { MessageKey } from '@/i18n'

function platformHint() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

/** "Show in Finder" / "Show in File Explorer" / "Show in File Manager". */
export function revealLabelKey(hint = platformHint()): MessageKey {
  return /Mac/iu.test(hint) ? 'sidebar.project.revealFinder'
    : /Windows/iu.test(hint) ? 'sidebar.project.revealExplorer' : 'sidebar.project.revealFileManager'
}

/** The file manager's own name, for the Open in menu. */
export function fileManagerNameKey(hint = platformHint()): MessageKey {
  return /Mac/iu.test(hint) ? 'editors.finder' : /Windows/iu.test(hint) ? 'editors.explorer' : 'editors.fileManager'
}
