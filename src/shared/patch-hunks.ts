/** One `@@` hunk of a unified diff, located by its first changed line. */
export interface PatchHunk {
  index: number
  /** The file header plus this hunk: a patch `git apply` accepts on its own. */
  patch: string
  anchor: { side: 'additions' | 'deletions'; lineNumber: number }
  /**
   * Where a row above the hunk's changes goes: after its last leading context
   * line, or (a hunk at the very top) above the file's first line.
   */
  top: { side: 'additions'; lineNumber: number }
  /** First and last new-side lines the hunk covers. */
  newStart: number
  newEnd: number
  added: number
  deleted: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

/** Splits a single-file unified diff into independently applicable hunks. */
export function patchHunks(patch: string): PatchHunk[] {
  const lines = patch.split('\n')
  const first = lines.findIndex((line) => HUNK_HEADER.test(line))
  if (first < 0) return []
  const header = lines.slice(0, first)
  // Only ordinary modifications split cleanly; renames, modes and binaries are whole-file.
  if (!header.some((line) => line.startsWith('--- ')) || !header.some((line) => line.startsWith('+++ '))) return []
  if (header.some((line) => /^(?:rename|copy) (?:from|to) |^(?:old|new) mode |^Binary files /u.test(line))) return []
  const hunks: PatchHunk[] = []
  let start = first
  while (start < lines.length && HUNK_HEADER.test(lines[start]!)) {
    let end = start + 1
    while (end < lines.length && !HUNK_HEADER.test(lines[end]!)) end += 1
    const body = lines.slice(start, end)
    const [, oldStart, newStart] = HUNK_HEADER.exec(body[0]!)!
    let oldLine = Number(oldStart)
    let newLine = Number(newStart)
    let anchor: PatchHunk['anchor'] | undefined
    let beforeChange = Number(newStart) - 1
    let added = 0
    let deleted = 0
    for (const line of body.slice(1)) {
      if (line.startsWith('+')) {
        anchor ??= { side: 'additions', lineNumber: newLine }
        added += 1
        newLine += 1
      } else if (line.startsWith('-')) {
        anchor ??= { side: 'deletions', lineNumber: oldLine }
        deleted += 1
        oldLine += 1
      } else if (line.startsWith(' ')) {
        if (!anchor) beforeChange = newLine
        oldLine += 1
        newLine += 1
      }
    }
    // Trailing empty string from the final newline belongs to no hunk.
    const text = [...header, ...body].join('\n').replace(/\n*$/u, '\n')
    if (anchor) hunks.push({ index: hunks.length, patch: text, anchor, top: { side: 'additions', lineNumber: Math.max(0, beforeChange) },
      newStart: Number(newStart), newEnd: Math.max(Number(newStart), newLine - 1), added, deleted })
    start = end
  }
  return hunks
}
