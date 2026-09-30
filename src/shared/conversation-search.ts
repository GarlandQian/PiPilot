import { z } from 'zod'
import { conversationScopeSchema, officialPiSessionSummarySchema } from './conversation-scope'

export const conversationSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(256),
  scopes: z.array(conversationScopeSchema).min(1).max(101),
  cursor: z.uuid().optional(),
}).strict()
export const conversationSearchHitSchema = z.object({
  session: officialPiSessionSummarySchema,
  entryId: z.string().min(1).max(256),
  anchorEntryId: z.string().min(1).max(256),
  role: z.enum(['user', 'assistant', 'toolResult']),
  toolCallId: z.string().min(1).max(2_048).optional(),
  snippet: z.string().max(640),
  matchStart: z.number().int().nonnegative(),
  matchLength: z.number().int().positive().max(256),
}).strict()
export const conversationSearchResultSchema = z.object({
  hits: z.array(conversationSearchHitSchema).max(300),
  nextCursor: z.uuid().nullable(),
  scanned: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  limited: z.boolean(),
}).strict()
export type ConversationSearchInput = z.infer<typeof conversationSearchInputSchema>
export type ConversationSearchHit = z.infer<typeof conversationSearchHitSchema>
export type ConversationSearchResult = z.infer<typeof conversationSearchResultSchema>
export type ConversationSearchMatch = Pick<ConversationSearchHit, 'role' | 'toolCallId' | 'snippet' | 'matchStart' | 'matchLength'>

/** Literal matching keeps source offsets intact, including Unicode case folding. */
export function findTextMatches(text: string, query: string, limit = 100) {
  if (!query.trim()) return []
  const expression = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu')
  const matches: { start: number; length: number }[] = []
  let match: RegExpExecArray | null
  while (matches.length < limit && (match = expression.exec(text))) {
    matches.push({ start: match.index, length: match[0].length })
  }
  return matches
}

export function searchSnippet(text: string, start: number, length: number) {
  const from = Math.max(0, start - 100)
  const to = Math.min(text.length, start + length + 180)
  return { snippet: text.slice(from, to), matchStart: start - from, matchLength: length }
}
