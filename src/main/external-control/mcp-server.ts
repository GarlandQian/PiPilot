import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { PIPILOT_VERSION } from '../../shared/build-info'
import {
  abortConversationInputSchema,
  externalControlReceiptSchema,
  getConversationStatusInputSchema,
  getConversationStatusResultSchema,
  getOperationInputSchema,
  getOperationResultSchema,
  listConversationsInputSchema,
  listConversationsResultSchema,
  sanitizeExternalControlError,
  sendPromptInputSchema,
  waitForTurnInputSchema,
  waitForTurnResultSchema,
  type ExternalControlBridgeMethod,
} from '../../shared/external-control'

export interface ExternalControlBridgeCaller {
  call(method: ExternalControlBridgeMethod, params: unknown): Promise<unknown>
}

function successfulToolResult(result: unknown): CallToolResult {
  const structuredContent = result as Record<string, unknown>
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  }
}

function failedToolResult(error: unknown): CallToolResult {
  const publicError = sanitizeExternalControlError(error)
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(publicError) }],
  }
}

async function callBridgeTool(
  bridge: ExternalControlBridgeCaller,
  method: ExternalControlBridgeMethod,
  params: unknown,
) {
  try {
    return successfulToolResult(await bridge.call(method, params))
  } catch (error) {
    return failedToolResult(error)
  }
}

export function createConversationMcpServer(
  bridge: ExternalControlBridgeCaller,
  serverVersion: string = PIPILOT_VERSION,
) {
  const server = new McpServer({
    name: 'pipilot-conversations',
    version: serverVersion,
  }, {
    capabilities: { tools: {} },
  })

  server.registerTool('list_conversations', {
    title: 'List PiPilot conversations',
    description: 'List bounded PiPilot conversation metadata and opaque IDs.',
    inputSchema: listConversationsInputSchema,
    outputSchema: listConversationsResultSchema,
    annotations: { readOnlyHint: true },
  }, (input) => callBridgeTool(bridge, 'list_conversations', input))

  server.registerTool('get_conversation_status', {
    title: 'Get PiPilot conversation status',
    description: 'Read current metadata and lifecycle for one opaque conversation ID.',
    inputSchema: getConversationStatusInputSchema,
    outputSchema: getConversationStatusResultSchema,
    annotations: { readOnlyHint: true },
  }, (input) => callBridgeTool(bridge, 'get_conversation_status', input))

  server.registerTool('send_prompt', {
    title: 'Send a PiPilot prompt',
    description: 'Reserve an idempotent external prompt operation and return its receipt.',
    inputSchema: sendPromptInputSchema,
    outputSchema: externalControlReceiptSchema,
    annotations: { idempotentHint: true },
  }, (input) => callBridgeTool(bridge, 'send_prompt', input))

  server.registerTool('abort_conversation', {
    title: 'Abort a PiPilot conversation',
    description: 'Reserve an idempotent abort operation for one active conversation.',
    inputSchema: abortConversationInputSchema,
    outputSchema: externalControlReceiptSchema,
    annotations: { destructiveHint: true, idempotentHint: true },
  }, (input) => callBridgeTool(bridge, 'abort_conversation', input))

  server.registerTool('get_operation', {
    title: 'Get a PiPilot operation',
    description: 'Read the current state of one external-control operation.',
    inputSchema: getOperationInputSchema,
    outputSchema: getOperationResultSchema,
    annotations: { readOnlyHint: true },
  }, (input) => callBridgeTool(bridge, 'get_operation', input))

  server.registerTool('wait_for_turn', {
    title: 'Wait for a PiPilot turn',
    description: 'Wait for authoritative acceptance or a terminal operation state.',
    inputSchema: waitForTurnInputSchema,
    outputSchema: waitForTurnResultSchema,
    annotations: { readOnlyHint: true },
  }, (input) => callBridgeTool(bridge, 'wait_for_turn', input))

  return server
}
