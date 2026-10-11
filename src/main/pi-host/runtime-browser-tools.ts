import { randomUUID } from 'node:crypto'
import type { InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { LocalPiRpcEvent } from '../../shared/local-pi'

/**
 * Pi's read-only view of the project browser in PiPilot: the open page's
 * address, a screenshot, and its console and network errors. The browser
 * lives in Main; a tool call asks it through the Runtime's event stream and
 * Main answers with a `browser_tool_response` command.
 */
type Emit = (event: LocalPiRpcEvent) => void
interface Answer { text: string; image?: { data: string; mimeType: 'image/png' }; isError?: boolean }

const emitters = new Map<string, Emit>()
const pending = new Map<string, { resolve(answer: Answer): void; timer: ReturnType<typeof setTimeout> }>()
const TIMEOUT_MS = 15_000

export function registerBrowserToolEmitter(sessionId: string, emit: Emit) {
  emitters.set(sessionId, emit)
  return () => { if (emitters.get(sessionId) === emit) emitters.delete(sessionId) }
}

export function answerBrowserTool(requestId: string, answer: Answer) {
  const waiting = pending.get(requestId)
  if (!waiting) return false
  pending.delete(requestId)
  clearTimeout(waiting.timer)
  waiting.resolve(answer)
  return true
}

function ask(sessionId: string, op: 'view' | 'logs', signal?: AbortSignal) {
  const emit = emitters.get(sessionId)
  if (!emit) return Promise.resolve<Answer>({ text: 'The PiPilot browser is not available to this conversation.', isError: true })
  return new Promise<Answer>((resolve) => {
    const requestId = randomUUID()
    const finish = (answer: Answer) => { if (answerBrowserTool(requestId, answer)) return; resolve(answer) }
    const timer = setTimeout(() => finish({ text: 'PiPilot did not answer in time. The browser may be closed.', isError: true }), TIMEOUT_MS)
    timer.unref?.()
    pending.set(requestId, { resolve, timer })
    signal?.addEventListener('abort', () => finish({ text: 'Cancelled.', isError: true }), { once: true })
    emit({ type: 'pipilot_browser_request', requestId, op })
  })
}

const NO_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false } as unknown as ToolDefinition['parameters']

export const PIPILOT_BROWSER_TOOLS_EXTENSION = {
  name: 'pipilot-browser',
  factory: (pi) => {
    const tool = (name: string, label: string, description: string, op: 'view' | 'logs') => pi.registerTool({
      name, label, description, promptSnippet: description,
      executionMode: 'parallel',
      parameters: NO_PARAMETERS,
      async execute(_callId, _parameters, signal, _onUpdate, ctx) {
        const answer = await ask(ctx.sessionManager.getSessionId(), op, signal)
        return {
          content: [{ type: 'text' as const, text: answer.text }, ...(answer.image ? [{ type: 'image' as const, data: answer.image.data, mimeType: answer.image.mimeType }] : [])],
          details: {},
          ...(answer.isError ? { isError: true } : {}),
        }
      },
    })
    tool('browser_screenshot', 'Look at the browser',
      "See the page open in PiPilot's built-in browser for this project: its address, title and a screenshot. Read-only; use it to check UI work.", 'view')
    tool('browser_logs', 'Read browser errors',
      "Read the console errors and failed network requests of the page open in PiPilot's built-in browser for this project. Read-only.", 'logs')
  },
} satisfies InlineExtension
