function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function stepSize(backlog: number, settling: boolean) {
  const fraction = settling ? 0.08 : 0.05
  const minimum = settling ? 5 : 3
  return Math.min(backlog, Math.max(Math.ceil(backlog * fraction), minimum))
}

export function nextTypewriterText(
  displayed: string,
  target: string,
  settling = false,
) {
  const prefixLength = target.startsWith(displayed)
    ? displayed.length
    : commonPrefixLength(displayed, target)
  const backlog = target.length - prefixLength
  if (backlog <= 0) return target
  return target.slice(0, prefixLength + stepSize(backlog, settling))
}

export function shouldStartTypewriterFromEmpty(
  motionEnabled: boolean,
  animateOnMount: boolean,
  streaming: boolean,
) {
  return motionEnabled && animateOnMount && streaming
}

/**
 * Keeps active reasoning visible, then collapses it at settlement unless the
 * user explicitly chose a disclosure state during that live phase.
 */
export function thinkingDisclosureAfterPhaseChange(
  wasStreaming: boolean,
  streaming: boolean,
  manualOpen: boolean | null,
): boolean | null {
  if (wasStreaming === streaming) return null
  if (streaming) return true
  return manualOpen ?? false
}
