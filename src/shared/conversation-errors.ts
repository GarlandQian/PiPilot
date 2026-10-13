export const EMPTY_ASSISTANT_CONTENT_FALLBACK = '[Empty assistant message]'

export type ConversationErrorCategory =
  | 'authentication'
  | 'configuration'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'empty-response'
  | 'cancelled'
  | 'unknown'

export interface ConversationErrorClassification {
  category: ConversationErrorCategory
  retryable: boolean
  sanitizedDetails: string
  status?: number
}

export function isEmptyAssistantPlaceholder(text: string): boolean {
  return text.trim() === EMPTY_ASSISTANT_CONTENT_FALLBACK
}

/** Error details may contain echoed request headers or credential-bearing URLs. */
export function sanitizeConversationErrorDetails(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s"',}\]]+/giu, '$1 [redacted]')
    .replace(/((?:^|[\s{[,;])["']?(?:api[_-]?key|x[_-]api[_-]key|(?:access|refresh|id|auth)[_-]?token|x[_-]auth[_-]token|token|authorization|password|(?:client[_-])?secret|(?:set[_-])?cookie)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/giu, '$1[redacted]')
    // Raw Cookie headers can carry several credentials separated by semicolons.
    .replace(/(\b(?:set-cookie|cookie)\s*:\s*)[^\r\n]*/giu, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/([?&](?:key|api[_-]?key|token|(?:access|refresh|id|auth)[_-]?token|(?:client[_-])?secret|password)=)[^&#\s"']*/giu, '$1[redacted]')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}\b/gu, '[redacted]')
    .slice(0, 16_000)
}

/** Classify conservatively: an HTTP/request error always wins over the word "empty". */
export function classifyConversationError(errorMessage: string | undefined): ConversationErrorClassification {
  const error = errorMessage?.trim() ?? ''
  const statusText = error.match(/(?:^(?:(?:Network error|Error):\s*)?|\b(?:HTTP|status(?: code)?|statusCode)\s*[:=]?\s*)([45]\d{2})(?=\b)/iu)?.[1]
  const status = statusText === undefined ? undefined : Number(statusText)
  const result = (category: ConversationErrorCategory, retryable: boolean): ConversationErrorClassification => ({
    category, retryable, sanitizedDetails: sanitizeConversationErrorDetails(error),
    ...(status === undefined ? {} : { status }),
  })
  if (status === 401 || status === 403 || /(?:unauthori[sz]ed|invalid.?api.?key|authentication failed|credentials? (?:expired|invalid)|no api key|access denied)/iu.test(error)) {
    return result('authentication', false)
  }
  if ((status !== undefined && status >= 400 && status < 500 && ![408, 429].includes(status)) ||
    /(?:invalid_request|invalid url|text content is empty|not allowed|unsupported (?:role|api|model)|model not found|context.{0,20}(?:limit|exceed|overflow)|quota exceeded|insufficient_quota|out of budget|billing|available balance|(?:monthly|subscription).*usage.*limit|GoUsageLimitError|FreeUsageLimitError)/iu.test(error)) {
    return result('configuration', false)
  }
  if (status === 429 || /(?:rate.?limit|too many requests|ResourceExhausted)/iu.test(error)) return result('rate-limit', true)
  if ([500, 502, 503, 504, 520, 524].includes(status ?? 0) || /(?:overloaded|server_busy|service.?unavailable|server.?error|internal.?error|servers are currently busy|model is at capacity|currently experiencing high demand|provider.?returned.?error|please retry your request|you can retry your request|try your request again|subscription_sharing_(?:usage|user)_unavailable)/iu.test(error)) return result('server', true)
  if (/\b(?:aborted|cancelled|canceled)\b/iu.test(error) && !/pending stream has been canceled/iu.test(error)) return result('cancelled', false)
  if (status === 408 || /(?:network.?error|connection.{0,10}(?:error|refused|lost|reset)|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed|upstream.?connect|reset before headers|timed? out|timeout|websocket.?closed|websocket.?error|stream ended|ended without|http2 request did not get a response|pending stream has been canceled)/iu.test(error)) {
    if (/ended without (?:any )?(?:text|content|assistant|response)/iu.test(error)) return result('empty-response', true)
    return result('network', true)
  }
  // Restrict this to recognizable response failures, never request validation like
  // `text content is empty`, which retrying cannot repair.
  if (/^(?:\[)?(?:empty assistant message|empty (?:upstream )?response|no (?:assistant )?response(?: received)?|no (?:assistant )?(?:output|content)(?: received)?)(?:\])?[.!]?$/iu.test(error)) return result('empty-response', true)
  return result('unknown', false)
}
