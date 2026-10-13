import { describe, expect, it } from 'vitest'
import { classifyConversationError, isEmptyAssistantPlaceholder, sanitizeConversationErrorDetails } from '../../src/shared/conversation-errors'

describe('conversation error diagnosis', () => {
  it.each([
    ['400: {"message":"text content is empty","type":"invalid_request_error"}', 'configuration', false],
    ["400: role 'developer' is not allowed", 'configuration', false],
    ['404: Invalid URL (POST /v1/v1/messages)', 'configuration', false],
    ['401: Unauthorized', 'authentication', false],
    ['403: Invalid API key', 'authentication', false],
    ['429: insufficient_quota', 'configuration', false],
    ['429: Too many requests', 'rate-limit', true],
    ['503: service unavailable', 'server', true],
    ['TypeError: fetch failed', 'network', true],
    ['ECONNRESET', 'network', true],
    ['Request aborted', 'cancelled', false],
    ['Empty response', 'empty-response', true],
    ['[Empty assistant message]', 'empty-response', true],
    ['Upstream response ended without any text or tool output.', 'empty-response', true],
    ['text content is empty', 'configuration', false],
    ['400: max_tokens must not exceed 500', 'configuration', false],
    ['401: Authentication failed for endpoint https://localhost:5000/v1', 'authentication', false],
    ['Error: 400: request failed; please retry your request', 'configuration', false],
    ['Unexpected unknown error', 'unknown', false],
  ])('classifies %s without conflating request errors and empty responses', (message, category, retryable) => {
    expect(classifyConversationError(message)).toMatchObject({ category, retryable })
  })

  it('redacts credentials while retaining the actionable URL path and status', () => {
    const diagnosis = classifyConversationError('401: POST https://user:password@api.example.test/v1/messages?token=private-token Authorization: Bearer private-bearer apiKey="private-key"')
    expect(diagnosis.status).toBe(401)
    expect(diagnosis.sanitizedDetails).toContain('api.example.test/v1/messages')
    expect(diagnosis.sanitizedDetails).not.toMatch(/private-|user:password/u)
  })

  it.each([
    ['{"token":"private-token"}', '{"token":[redacted]}'],
    ['{"x-auth-token":"private-token"}', '{"x-auth-token":[redacted]}'],
    ['{"Cookie":"session=private-session; csrf=private-csrf"}', '{"Cookie":[redacted]}'],
    ['Cookie: session=private-session; csrf=private-csrf\nHTTP 401', 'Cookie: [redacted]\nHTTP 401'],
    ['Set-Cookie: session=private-session; Path=/; HttpOnly', 'Set-Cookie: [redacted]'],
    ['{"password":"private-\\"quoted-secret"}', '{"password":[redacted]}'],
    ['Credential rejected: ghp_abcdefghijklmnopqrstuvwx', 'Credential rejected: [redacted]'],
    ['Credential rejected: github_pat_abcdefghijklmnopqrstuvwx', 'Credential rejected: [redacted]'],
    ['401: GET https://private-token@api.example.test/v1/messages', '401: GET https://[redacted]@api.example.test/v1/messages'],
    ['GET https://api.example.test/v1?client_secret=private-secret&model=test', 'GET https://api.example.test/v1?client_secret=[redacted]&model=test'],
  ])('redacts credential forms in %s', (source, expected) => {
    expect(sanitizeConversationErrorDetails(source)).toBe(expected)
  })

  it('keeps non-secret request parameters and response diagnostics useful', () => {
    const details = 'HTTP 400: {"max_tokens":500,"token_count":17,"model":"test","message":"text content is empty"}'
    expect(sanitizeConversationErrorDetails(details)).toBe(details)
  })

  it('only hides the exact legacy placeholder, never ordinary quoted text', () => {
    expect(isEmptyAssistantPlaceholder(' [Empty assistant message] ')).toBe(true)
    expect(isEmptyAssistantPlaceholder('Example: [Empty assistant message]')).toBe(false)
  })
})
