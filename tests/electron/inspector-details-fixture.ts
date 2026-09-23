/** Official Pi JSONL history shared by the full workflow and focused inspector tests. */
export function inspectorDetailsSessionEntries(cwd: string) {
  const timestamp = '2026-08-09T00:00:00.000Z'
  const message = (suffix: string, parent: string | null, time: string, content: Record<string, unknown>) => ({
    type: 'message', id: `00000000-0000-4000-8000-000000000${suffix}`,
    parentId: parent ? `00000000-0000-4000-8000-000000000${parent}` : null,
    timestamp: time, message: { ...content, timestamp: Date.parse(time) },
  })
  const assistant = {
    api: 'openai-completions', provider: 'fixture', model: 'fake-fast',
    usage: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 20,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
  return [
    { type: 'session', version: 3, id: 'real-sdk-session', timestamp, cwd },
    message('101', null, timestamp, { role: 'user', content: 'Selected session history prompt' }),
    message('103', '101', '2026-08-09T00:00:01.000Z', {
      ...assistant, role: 'assistant', stopReason: 'stop',
      content: [{ type: 'text', text: 'Selected session history response' }],
    }),
    message('105', '103', '2026-08-09T00:00:01.100Z', {
      role: 'user', content: 'Delegate the focused renderer review.',
    }),
    message('106', '105', '2026-08-09T00:00:01.200Z', {
      ...assistant, role: 'assistant', stopReason: 'toolUse',
      usage: { input: 8, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      content: [{ type: 'toolCall', id: 'fixture-subagent-call', name: 'subagent', arguments: {
        agent: 'project-worker',
        task: 'Active task: project/tasks/private\n\n## Preserve behavior\n\n- Keep the existing contract.\n- Render **Markdown**.',
      } }],
    }),
    message('107', '106', '2026-08-09T00:00:01.300Z', {
      role: 'toolResult', toolCallId: 'fixture-subagent-call', toolName: 'subagent', isError: false,
      content: [{ type: 'text', text: 'Run fan-out: 0/64 used, 64 remaining\nAsync workflow [325bb64b-1779-4163-b44c-9179e8092a26]\n\nThe async run is detached and running in the background.\nDo NOT call subagent_wait merely to wait.' }],
      details: { results: [{ agent: 'project-worker', exitCode: 0, messages: [
        { role: 'assistant', content: [{ type: 'toolCall', id: 'fixture-subagent-bash', name: 'bash',
          arguments: { command: 'pnpm test', cwd: '/workspace', timeout: 30_000 } }] },
        { role: 'toolResult', toolCallId: 'fixture-subagent-bash', toolName: 'bash', isError: false,
          content: [{ type: 'text', text: 'Focused checks passed.' }] },
        { role: 'assistant', content: [{ type: 'text', text: '## Done\n\nEverything is green.' }] },
      ] }] },
    }),
    message('108', '107', '2026-08-09T00:00:01.400Z', {
      role: 'bashExecution', command: 'pnpm test',
      output: '## Checks\n\n- All checks passed.\n- Markdown output.',
      exitCode: 0, cancelled: false, truncated: false,
    }),
    { type: 'model_change', id: '00000000-0000-4000-8000-000000000104',
      parentId: '00000000-0000-4000-8000-000000000108', timestamp: '2026-08-09T00:00:02.000Z',
      provider: 'fixture', modelId: 'fake-fast' },
    { type: 'session_info', id: '00000000-0000-4000-8000-000000000102',
      parentId: '00000000-0000-4000-8000-000000000104', timestamp: '2026-08-09T00:00:03.000Z',
      name: 'Existing project session' },
  ]
}
