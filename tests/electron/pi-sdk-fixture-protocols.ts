import type { ServerResponse } from 'node:http'

export const FIXTURE_PROVIDER_PROTOCOLS = [
  'openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai',
] as const
export type FixtureProviderProtocol = typeof FIXTURE_PROVIDER_PROTOCOLS[number]
export const FIXTURE_WRITE_CALL_ID = 'call_pipilot_fixture_write'

type JsonRecord = Record<string, unknown>
function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord : {}
}
function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : []
}
function contentText(value: unknown) {
  if (typeof value === 'string') return value
  return records(value).map((part) => typeof part.text === 'string' ? part.text : '').join('')
}

export function fixtureRequestPath(protocol: FixtureProviderProtocol, url: string) {
  const pathname = new URL(url, 'http://fixture.invalid').pathname
  switch (protocol) {
    case 'openai-completions': return pathname === '/v1/chat/completions'
    case 'openai-responses': return pathname === '/v1/responses'
    case 'anthropic-messages': return pathname === '/v1/messages'
    case 'google-generative-ai': return /^\/v1(?:beta)?\/models\/[^/]+:streamGenerateContent$/u.test(pathname)
  }
}

export function readFixtureRequest(protocol: FixtureProviderProtocol, body: unknown) {
  const request = record(body)
  const messages = records(protocol === 'openai-responses' ? request.input
    : protocol === 'google-generative-ai' ? request.contents : request.messages)
  let prompt = ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'user') continue
    prompt = contentText(protocol === 'google-generative-ai' ? message.parts : message.content)
    if (prompt) break
  }
  const hasWriteResult = messages.some((message) => {
    switch (protocol) {
      case 'openai-completions': return message.role === 'tool' && message.tool_call_id === FIXTURE_WRITE_CALL_ID
      case 'openai-responses': return message.type === 'function_call_output' && message.call_id === FIXTURE_WRITE_CALL_ID
      case 'anthropic-messages': return records(message.content).some((part) => part.type === 'tool_result' && part.tool_use_id === FIXTURE_WRITE_CALL_ID)
      case 'google-generative-ai': return records(message.parts).some((part) => record(part.functionResponse).name === 'write')
    }
  })
  return { prompt, hasWriteResult, model: typeof request.model === 'string' ? request.model : 'fake-chat' }
}

export interface FixtureStreamWriter {
  text(text: string): void
  thinking(text: string): void
  writeTool(args: { path: string; content: string }): void
  finish(tool: boolean): void
}

/** Wire encoders only: the installed Pi SDK parses every response and runs tools. */
export function createFixtureStreamWriter(
  protocol: FixtureProviderProtocol,
  response: ServerResponse,
  model: string,
): FixtureStreamWriter {
  response.writeHead(200, {
    'cache-control': 'no-cache', connection: 'keep-alive', 'content-type': 'text/event-stream',
  })
  const data = (value: unknown) => response.write(`data: ${JSON.stringify(value)}\n\n`)
  const event = (type: string, value: JsonRecord = {}) => {
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  }
  const pieces = (text: string) => {
    const midpoint = Math.max(1, Math.floor(text.length / 2))
    return [text.slice(0, midpoint), text.slice(midpoint)].filter(Boolean)
  }

  if (protocol === 'openai-completions') {
    const chunk = (delta: JsonRecord, finish: string | null = null) => data({
      id: 'chatcmpl-pipilot-fixture', object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000), model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(finish ? { usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } } : {}),
    })
    return {
      text: (text) => { for (const content of pieces(text)) chunk({ role: 'assistant', content }) },
      thinking: (text) => chunk({ role: 'assistant', reasoning_content: text }),
      writeTool: (args) => {
        const argumentsPieces = pieces(JSON.stringify(args))
        argumentsPieces.forEach((argumentsPart, index) => chunk({
          role: 'assistant', tool_calls: [{
            index: 0,
            ...(index === 0 ? { id: FIXTURE_WRITE_CALL_ID, type: 'function' } : {}),
            function: { ...(index === 0 ? { name: 'write' } : {}), arguments: argumentsPart },
          }],
        }))
      },
      finish: (tool) => { chunk({}, tool ? 'tool_calls' : 'stop'); response.end('data: [DONE]\n\n') },
    }
  }

  if (protocol === 'openai-responses') {
    const output: JsonRecord[] = []
    let sequence = 0
    const emit = (type: string, value: JsonRecord) => event(type, { sequence_number: sequence++, ...value })
    const responseBody = (status: string) => ({
      id: 'resp_pipilot_fixture', object: 'response', created_at: 1, status, model, output,
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    })
    emit('response.created', { response: responseBody('in_progress') })
    const item = (initial: JsonRecord, final: JsonRecord, deltaType: string, delta: string) => {
      const index = output.length
      emit('response.output_item.added', { output_index: index, item: initial })
      for (const part of pieces(delta)) emit(deltaType, { output_index: index, item_id: initial.id, content_index: 0, summary_index: 0, delta: part })
      emit('response.output_item.done', { output_index: index, item: final })
      output.push(final)
    }
    return {
      text: (text) => {
        const base = { id: `msg_fixture_${output.length}`, type: 'message', role: 'assistant' }
        item({ ...base, status: 'in_progress', content: [] }, {
          ...base, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }],
        }, 'response.output_text.delta', text)
      },
      thinking: (text) => {
        const base = { id: `rs_fixture_${output.length}`, type: 'reasoning' }
        item({ ...base, summary: [] }, { ...base, summary: [{ type: 'summary_text', text }] }, 'response.reasoning_summary_text.delta', text)
      },
      writeTool: (args) => {
        const base = { id: `fc_fixture_${output.length}`, type: 'function_call', call_id: FIXTURE_WRITE_CALL_ID, name: 'write' }
        item({ ...base, arguments: '' }, { ...base, arguments: JSON.stringify(args), status: 'completed' }, 'response.function_call_arguments.delta', JSON.stringify(args))
      },
      finish: () => { emit('response.completed', { response: responseBody('completed') }); response.end() },
    }
  }

  if (protocol === 'anthropic-messages') {
    let index = 0
    event('message_start', { message: {
      id: 'msg_pipilot_fixture', type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 },
    } })
    const block = (content_block: JsonRecord, type: string, field: string, text: string) => {
      event('content_block_start', { index, content_block })
      for (const value of pieces(text)) event('content_block_delta', { index, delta: { type, [field]: value } })
      event('content_block_stop', { index })
      index += 1
    }
    return {
      text: (text) => block({ type: 'text', text: '' }, 'text_delta', 'text', text),
      thinking: (text) => block({ type: 'thinking', thinking: '', signature: '' }, 'thinking_delta', 'thinking', text),
      writeTool: (args) => block({ type: 'tool_use', id: FIXTURE_WRITE_CALL_ID, name: 'write', input: {} }, 'input_json_delta', 'partial_json', JSON.stringify(args)),
      finish: (tool) => {
        event('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
        event('message_stop')
        response.end()
      },
    }
  }

  const google = (parts: JsonRecord[], finish = false) => data({
    responseId: 'google_fixture_response', modelVersion: model,
    candidates: [{ index: 0, content: { role: 'model', parts }, ...(finish ? { finishReason: 'STOP' } : {}) }],
    ...(finish ? { usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 } } : {}),
  })
  return {
    text: (text) => { for (const part of pieces(text)) google([{ text: part }]) },
    thinking: (text) => google([{ text, thought: true }]),
    writeTool: (args) => google([{ functionCall: { id: FIXTURE_WRITE_CALL_ID, name: 'write', args } }]),
    finish: () => { google([], true); response.end() },
  }
}
