import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { conversationSearchInputSchema, conversationSearchResultSchema } from '../conversation-search'

export const conversationSearchContract = defineIpcContract('pipilot:conversation-search:find',
  z.object({ context: requestContextSchema, input: conversationSearchInputSchema }).strict(),
  conversationSearchResultSchema)
