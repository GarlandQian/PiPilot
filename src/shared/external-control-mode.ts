import { z } from 'zod'

export const EXTERNAL_CONTROL_MAX_PROMPT_BYTES = 128 * 1024

const utf8 = new TextEncoder()

export const externalControlPromptSchema = z
  .string()
  .refine(
    (value) => utf8.encode(value).byteLength <= EXTERNAL_CONTROL_MAX_PROMPT_BYTES,
    'Prompt exceeds the UTF-8 byte limit.',
  )
  .refine((value) => value.trim().length > 0, 'Prompt must not be empty.')

export const externalControlRequestedModeSchema = z.enum([
  'auto',
  'prompt',
  'follow_up',
  'steer',
])

export const externalControlAcceptedModeSchema = z.enum([
  'prompt',
  'follow_up',
  'steer',
])

export type ExternalControlRequestedMode = z.infer<
  typeof externalControlRequestedModeSchema
>
export type ExternalControlAcceptedMode = z.infer<
  typeof externalControlAcceptedModeSchema
>
