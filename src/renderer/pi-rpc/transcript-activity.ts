import type { AgentStatus, Turn } from '@/types/chat'
import { adjacentTurnChanges } from './turn-changes'
import { agentAnimationKey } from './live-typewriter'

function sameActivity(left: Turn | undefined, right: Turn | undefined) {
  if (!left || !right || left.kind !== right.kind) return false
  if (left.kind === 'agent' && right.kind === 'agent') return left.id === right.id && left.state === right.state
  return left.kind === 'user' || left.kind === 'response-actions' ? left.id === right.id : true
}

/** Content deltas retain animation indexes; only activity/structure can alter them. */
export function createTranscriptActivityProjector() {
  let previous: readonly Turn[] = []
  let status: AgentStatus | undefined
  let agents: Extract<Turn, { kind: 'agent' }>[] = []
  let agentKeys: ReadonlySet<string> = new Set()
  let responseAgents: ReadonlyMap<string, readonly string[]> = new Map()
  let streamingKeys: ReadonlySet<string> = new Set()
  let snapshot = { agentKeys, responseAgents, streamingKeys }
  return (turns: readonly Turn[], nextStatus: AgentStatus) => {
    const changes = adjacentTurnChanges(previous, turns)
    const structureChanged = !changes || changes.some(({ before, after }) => !sameActivity(before, after))
    previous = turns
    if (!structureChanged && status === nextStatus) return snapshot
    if (structureChanged) {
      agents = []
      const responses = new Map<string, readonly string[]>()
      let current: string[] = []
      for (const turn of turns) {
        if (turn.kind === 'user') current = []
        else if (turn.kind === 'agent') { agents.push(turn); current.push(agentAnimationKey(turn)) }
        else if (turn.kind === 'response-actions') { responses.set(turn.id, current); current = [] }
      }
      agentKeys = new Set(agents.map(agentAnimationKey))
      responseAgents = responses
    }
    const latest = agents[agents.length - 1]?.id
    streamingKeys = new Set(agents.filter((turn) => turn.state === 'streaming' || (
      turn.state === undefined && nextStatus === 'running' && turn.id === latest
    )).map(agentAnimationKey))
    status = nextStatus
    snapshot = { agentKeys, responseAgents, streamingKeys }
    return snapshot
  }
}
