import { describe, expect, it } from 'vitest'
import { parsePiSessionImport } from '../../src/main/conversations/pi-session-import'

const lines = (...entries: object[]) => Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n'))
const header = { type: 'session', version: 3, id: 'session-1', timestamp: '2026-10-01T00:00:00.000Z', cwd: '/work/demo' }
const message = (id: string, parentId: string | null, role: string, content: unknown) => ({ type: 'message', id, parentId, timestamp: '2026-10-01T00:00:01.000Z', message: { role, content } })

describe('Pi session import', () => {
  it('imports the messages on the current branch without tools', () => {
    const parsed = parsePiSessionImport('/tmp/demo.jsonl', lines(header,
      message('a', null, 'user', 'First question'),
      message('b', 'a', 'assistant', [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Old answer' }]),
      message('c', 'a', 'assistant', [{ type: 'toolCall', id: 't', name: 'bash', arguments: {} }, { type: 'text', text: 'New answer' }]),
      message('d', 'c', 'toolResult', [{ type: 'text', text: 'tool output' }]),
      { type: 'session_info', id: 'e', parentId: 'd', timestamp: '2026-10-01T00:00:02.000Z', name: 'Named session' },
    ), 'en-US')
    expect(parsed.title).toBe('Named session')
    expect(parsed.sourceCwd).toBe('/work/demo')
    expect(parsed.history.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'First question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'New answer' }] },
    ])
    expect(parsed.warnings).toContain('toolsOmitted')
    expect(parsed.previewMarkdown).not.toContain('Old answer')
  })

  it('rejects files that are not Pi sessions', () => {
    expect(() => parsePiSessionImport('/tmp/demo.jsonl', lines({ type: 'other' }), 'en-US')).toThrow('not a Pi session')
    expect(() => parsePiSessionImport('/tmp/demo.json', lines(header), 'en-US')).toThrow('Pi session file')
    expect(() => parsePiSessionImport('/tmp/demo.jsonl', lines(header), 'en-US')).toThrow('no messages')
  })
})
