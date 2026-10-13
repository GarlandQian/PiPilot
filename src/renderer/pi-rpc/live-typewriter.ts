import type { Turn } from '@/types/chat'

export function transientTurnAnimationKey(turnId: string) {
  return turnId.replace(/:(?:stream|message):(\d+):[^:]+:/, ':message:$1:')
}

export function agentAnimationKey(turn: Extract<Turn, { kind: 'agent' }>) {
  return transientTurnAnimationKey(turn.id)
}

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
