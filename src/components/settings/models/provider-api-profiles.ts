/** API-key/custom endpoint adapters exposed by the connection form. OAuth-only
 * adapters remain editable when already configured, including through JSON. */
export const CUSTOM_ENDPOINT_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-vertex',
  'azure-openai-responses',
  'mistral-conversations',
  'bedrock-converse-stream',
] as const

const API_PROFILES = {
  'openai-completions': { kind: 'openai', credential: 'apiKey', placeholder: 'https://api.example.com/v1', listModels: true, localKey: true },
  'openai-responses': { kind: 'responses', credential: 'apiKey', placeholder: 'https://api.openai.com/v1', listModels: true, localKey: true },
  'anthropic-messages': { kind: 'anthropic', credential: 'apiKey', placeholder: 'https://api.anthropic.com', listModels: true, localKey: true },
  'google-generative-ai': { kind: 'gemini', credential: 'apiKey', placeholder: 'https://generativelanguage.googleapis.com/v1beta', listModels: true, localKey: true },
  'openai-codex-responses': { kind: 'codex', credential: 'oauthToken', placeholder: 'https://chatgpt.com/backend-api/codex', listModels: false, localKey: false },
  'google-vertex': { kind: 'vertex', credential: 'vertexKey', placeholder: 'https://aiplatform.googleapis.com', listModels: false, localKey: false },
  'azure-openai-responses': { kind: 'azure', credential: 'azureKey', placeholder: 'https://your-resource.openai.azure.com/openai/v1', listModels: false, localKey: false },
  'mistral-conversations': { kind: 'mistral', credential: 'apiKey', placeholder: 'https://api.mistral.ai', listModels: false, localKey: true },
  'bedrock-converse-stream': { kind: 'bedrock', credential: 'bedrockToken', placeholder: 'https://bedrock-runtime.us-east-1.amazonaws.com', listModels: false, localKey: false },
} as const

/** Unknown extension APIs and an inherited built-in API have no generic /models
 * contract. Never infer their authentication from a localhost URL. */
export function providerApiProfile(api: string, inheritedProviderId?: string) {
  if (!api && inheritedProviderId) {
    if (inheritedProviderId === 'openai-codex') return API_PROFILES['openai-codex-responses']
    return { kind: 'inherited', credential: 'inherited', placeholder: 'https://api.example.com', listModels: false, localKey: false } as const
  }
  const effectiveApi = api || 'openai-completions'
  if (Object.prototype.hasOwnProperty.call(API_PROFILES, effectiveApi)) return API_PROFILES[effectiveApi as keyof typeof API_PROFILES]
  return { kind: 'extension', credential: 'extension', placeholder: 'https://api.example.com', listModels: false, localKey: false } as const
}

export function customEndpointApiOptions(current: string): readonly string[] {
  return current && !(CUSTOM_ENDPOINT_API_TYPES as readonly string[]).includes(current)
    ? [...CUSTOM_ENDPOINT_API_TYPES, current]
    : CUSTOM_ENDPOINT_API_TYPES
}
