import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { conversationExportRequestSchema, conversationExportResultSchema } from '../conversation-export'

export const conversationExportContract = defineIpcContract('pipilot:conversation-export:save',
  z.object({ context: requestContextSchema, input: conversationExportRequestSchema }).strict(),
  conversationExportResultSchema)
