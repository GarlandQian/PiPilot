function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function stepSize(backlog: number) {
  return Math.min(backlog, Math.max(Math.ceil(backlog * 0.05), 3))
}

export function nextTypewriterText(
  displayed: string,
  target: string,
  settling = false,
) {
  if (settling) return target
  const prefixLength = target.startsWith(displayed)
    ? displayed.length
    : commonPrefixLength(displayed, target)
  const backlog = target.length - prefixLength
  if (backlog <= 0) return target
  return target.slice(0, prefixLength + stepSize(backlog))
}

export function shouldStartTypewriterFromEmpty(
  motionEnabled: boolean,
  animateOnMount: boolean,
  streaming: boolean,
) {
  return motionEnabled && animateOnMount && streaming
}

/**
 * Settlement changes the status, not the reader's disclosure or viewport.
 * Hydrated history still starts closed in the presentation component.
 */
export function thinkingDisclosureAfterPhaseChange(
  wasStreaming: boolean,
  streaming: boolean,
  manualOpen: boolean | null,
): boolean | null {
  if (wasStreaming === streaming) return null
  if (streaming) return true
  return manualOpen ?? true
}
