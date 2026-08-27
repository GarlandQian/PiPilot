const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = Buffer.concat(chunks).toString('utf8')
const command = JSON.parse(input.trim())
const mode = process.env.FAKE_PI_MANAGEMENT_HOST_MODE

if (mode === 'hang') {
  process.on('SIGTERM', () => undefined)
  setInterval(() => undefined, 1000)
  await new Promise(() => undefined)
}

if (mode === 'malformed') {
  process.stdout.write('{not-json}\n')
  process.exit(0)
}

if (command.action === 'install') {
  process.stdout.write(`${JSON.stringify({
    type: 'progress',
    operationId: command.operationId,
    progress: {
      type: 'progress',
      action: 'install',
      source: command.source,
      message: 'Installing fixture',
    },
  })}\n`)
}

const result = {
  packages: [],
  resources: [],
  updates: [],
  retry: {
    globalEnabled: true,
    effective: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
  },
  diagnostics: [],
}
const record = JSON.stringify({
  type: 'result',
  operationId: command.operationId,
  result,
})
process.stdout.write(`${record}\n`)
if (mode === 'duplicate') process.stdout.write(`${record}\n`)
if (mode === 'post-final-progress') process.stdout.write(`${JSON.stringify({
  type: 'progress',
  operationId: command.operationId,
  progress: {
    type: 'progress',
    action: 'install',
    source: 'npm:fixture',
    message: 'late progress',
  },
})}\n`)
