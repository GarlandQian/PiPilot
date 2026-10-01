import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { conversationImportCommitRequestSchema, conversationImportCommitResultSchema, conversationImportDiscardRequestSchema, conversationImportDiscardResultSchema, conversationImportPreviewRequestSchema, conversationImportPreviewResultSchema } from '../conversation-import'

export const conversationImportPreviewContract = defineIpcContract('pipilot:conversation-import:preview',
  z.object({ context: requestContextSchema, input: conversationImportPreviewRequestSchema }).strict(), conversationImportPreviewResultSchema)
export const conversationImportCommitContract = defineIpcContract('pipilot:conversation-import:commit',
  z.object({ context: requestContextSchema, input: conversationImportCommitRequestSchema }).strict(), conversationImportCommitResultSchema)
export const conversationImportDiscardContract = defineIpcContract('pipilot:conversation-import:discard',
  z.object({ context: requestContextSchema, input: conversationImportDiscardRequestSchema }).strict(), conversationImportDiscardResultSchema)
