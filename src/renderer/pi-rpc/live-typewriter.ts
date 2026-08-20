function commonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

function stepSize(backlog: number, settling: boolean) {
  if (settling) {
    if (backlog > 1_200) return 12
    if (backlog > 400) return 8
    if (backlog > 120) return 5
    if (backlog > 48) return 3
    return Math.min(backlog, 2)
  }
  if (backlog > 1_200) return 6
  if (backlog > 400) return 4
  if (backlog > 120) return 3
  if (backlog > 48) return 2
  return 1
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
  return motionEnabled && (animateOnMount || streaming)
}
