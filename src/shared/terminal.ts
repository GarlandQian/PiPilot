import { z } from 'zod'
import { conversationScopeSchema } from './conversation-scope'

export const TERMINAL_INPUT_LIMIT = 64 * 1024
export const TERMINAL_OUTPUT_EVENT_LIMIT = 64 * 1024
export const TERMINAL_REPLAY_LIMIT = 1024 * 1024
export const TERMINAL_MAX_COUNT = 4
export const TERMINAL_MIN_COLUMNS = 2
export const TERMINAL_MAX_COLUMNS = 500
export const TERMINAL_MIN_ROWS = 1
export const TERMINAL_MAX_ROWS = 300

export const terminalIdSchema = z.uuid()

export const terminalColumnsSchema = z
  .number()
  .int()
  .min(TERMINAL_MIN_COLUMNS)
  .max(TERMINAL_MAX_COLUMNS)

export const terminalRowsSchema = z
  .number()
  .int()
  .min(TERMINAL_MIN_ROWS)
  .max(TERMINAL_MAX_ROWS)

export const terminalSessionSchema = z
  .object({
    scope: conversationScopeSchema,
    terminalId: terminalIdSchema,
    shell: z.string().min(1).max(128),
    cols: terminalColumnsSchema,
    rows: terminalRowsSchema,
    replay: z.string().max(TERMINAL_REPLAY_LIMIT),
    sequence: z.number().int().nonnegative(),
    reused: z.boolean(),
  })
  .strict()

export type TerminalSession = z.infer<typeof terminalSessionSchema>

export const terminalActionResultSchema = z
  .object({
    scope: conversationScopeSchema,
    terminalId: terminalIdSchema,
  })
  .strict()

export type TerminalActionResult = z.infer<typeof terminalActionResultSchema>

export const terminalResizeResultSchema = terminalActionResultSchema
  .extend({
    cols: terminalColumnsSchema,
    rows: terminalRowsSchema,
  })
  .strict()

export type TerminalResizeResult = z.infer<typeof terminalResizeResultSchema>

export const terminalEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('data'),
      eventId: z.uuid(),
      scope: conversationScopeSchema,
      terminalId: terminalIdSchema,
      sequence: z.number().int().positive(),
      stream: z.literal('pty'),
      data: z.string().min(1).max(TERMINAL_OUTPUT_EVENT_LIMIT),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('exit'),
      eventId: z.uuid(),
      scope: conversationScopeSchema,
      terminalId: terminalIdSchema,
      sequence: z.number().int().positive(),
      exitCode: z.number().int().min(-1).max(2 ** 31 - 1),
      signal: z.number().int().nonnegative().max(255).optional(),
    })
    .strict(),
])

export type TerminalEvent = z.infer<typeof terminalEventSchema>
