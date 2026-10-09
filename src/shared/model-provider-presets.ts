/*
 * Ready-made providers for "Add provider". The list, endpoints and
 * compatibility settings started from cc-switch's Pi presets
 * (https://github.com/farion1231/cc-switch, MIT), without its relays,
 * promotions or referral parameters.
 *
 * A row is one company; its versions are the ways to reach it (regions,
 * subscriptions, pay-as-you-go). A "builtin" version is one of Pi's own
 * providers: Pi knows its address and models, so only a key is asked and it
 * is stored in Pi's auth.json. A "custom" version is written to models.json.
 */

export interface LocalizedText {
  en: string
  zh: string
}

export type ProviderPresetCategory = 'international' | 'china' | 'aggregator' | 'local' | 'custom'

export const PROVIDER_PRESET_CATEGORIES: readonly ProviderPresetCategory[] = ['international', 'china', 'aggregator', 'local', 'custom']

export type ProviderPresetApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'

export interface BuiltinPresetVersion {
  kind: 'builtin'
  key: string
  label: LocalizedText
  /** Pi's provider ID. */
  providerId: string
  apiKeyUrl?: string
}

export interface CustomPresetVersion {
  kind: 'custom'
  key: string
  label: LocalizedText
  /** The models.json ID suggested for it. */
  providerId: string
  baseUrl: string
  api: ProviderPresetApi
  compat?: Readonly<Record<string, unknown>>
  apiKeyUrl?: string
  /** A server on this computer: it needs no key. */
  local?: boolean
}

export type ProviderPresetVersion = BuiltinPresetVersion | CustomPresetVersion

export interface ProviderPreset {
  key: string
  name: LocalizedText
  /** Other names people search by. */
  aliases: readonly string[]
  category: ProviderPresetCategory
  /** A logo from @lobehub/icons-static-svg; without one the initials stand in. */
  icon?: string
  website?: string
  versions: readonly [ProviderPresetVersion, ...ProviderPresetVersion[]]
}

const text = (en: string, zh = en): LocalizedText => ({ en, zh })

const builtin = (key: string, providerId: string, label: LocalizedText, apiKeyUrl?: string): BuiltinPresetVersion =>
  ({ kind: 'builtin', key, providerId, label, ...(apiKeyUrl ? { apiKeyUrl } : {}) })

const custom = (key: string, options: Omit<CustomPresetVersion, 'kind' | 'key'>): CustomPresetVersion =>
  ({ kind: 'custom', key, ...options })

const PAY_AS_YOU_GO = text('Pay as you go', '按量计费')
const GLOBAL = text('International', '国际版')
const CHINA = text('China', '中国版')

/** DashScope sends reasoning in Qwen's own format and rejects the developer role. */
const QWEN_COMPAT = { thinkingFormat: 'qwen', supportsDeveloperRole: false } as const

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: 'anthropic', name: text('Anthropic'), aliases: ['claude'], category: 'international', icon: 'claude-color',
    website: 'https://www.anthropic.com',
    versions: [builtin('anthropic', 'anthropic', text('API'), 'https://console.anthropic.com/settings/keys')],
  },
  {
    key: 'openai', name: text('OpenAI'), aliases: ['gpt', 'chatgpt'], category: 'international', icon: 'openai',
    website: 'https://openai.com',
    versions: [builtin('openai', 'openai', text('API'), 'https://platform.openai.com/api-keys')],
  },
  {
    key: 'google', name: text('Google Gemini'), aliases: ['gemini', 'google', 'ai studio'], category: 'international', icon: 'gemini-color',
    website: 'https://ai.google.dev',
    versions: [builtin('google', 'google', text('AI Studio'), 'https://aistudio.google.com/apikey')],
  },
  {
    key: 'xai', name: text('xAI'), aliases: ['grok'], category: 'international', icon: 'xai',
    website: 'https://x.ai',
    versions: [builtin('xai', 'xai', text('API'), 'https://console.x.ai')],
  },
  {
    key: 'mistral', name: text('Mistral AI'), aliases: ['mistral', 'codestral'], category: 'international', icon: 'mistral-color',
    website: 'https://mistral.ai',
    versions: [builtin('mistral', 'mistral', text('API'), 'https://console.mistral.ai/api-keys')],
  },
  {
    key: 'groq', name: text('Groq'), aliases: [], category: 'international', icon: 'groq',
    website: 'https://groq.com',
    versions: [builtin('groq', 'groq', text('API'), 'https://console.groq.com/keys')],
  },
  {
    key: 'cerebras', name: text('Cerebras'), aliases: [], category: 'international', icon: 'cerebras-color',
    website: 'https://www.cerebras.ai',
    versions: [builtin('cerebras', 'cerebras', text('API'), 'https://cloud.cerebras.ai')],
  },
  {
    key: 'deepseek', name: text('DeepSeek', '深度求索 DeepSeek'), aliases: ['deepseek', '深度求索'], category: 'china', icon: 'deepseek-color',
    website: 'https://www.deepseek.com',
    versions: [builtin('deepseek', 'deepseek', text('API'), 'https://platform.deepseek.com/api_keys')],
  },
  {
    key: 'kimi', name: text('Kimi (Moonshot AI)', 'Kimi（月之暗面）'), aliases: ['kimi', 'moonshot', '月之暗面'], category: 'china', icon: 'kimi',
    website: 'https://www.moonshot.ai',
    versions: [
      builtin('moonshotai-cn', 'moonshotai-cn', CHINA, 'https://platform.kimi.com/console/api-keys'),
      builtin('moonshotai', 'moonshotai', GLOBAL, 'https://platform.kimi.ai/console/api-keys'),
      builtin('kimi-coding', 'kimi-coding', text('Kimi For Coding'), 'https://platform.kimi.com/console/api-keys'),
    ],
  },
  {
    key: 'zhipu', name: text('Zhipu GLM / Z.ai', '智谱 GLM / Z.ai'), aliases: ['zhipu', 'glm', 'bigmodel', 'z.ai', 'zai', '智谱'], category: 'china', icon: 'zhipu-color',
    website: 'https://open.bigmodel.cn',
    versions: [
      builtin('zai-coding-cn', 'zai-coding-cn', text('GLM Coding Plan (China)', 'GLM Coding Plan（中国）'), 'https://open.bigmodel.cn/usercenter/apikeys'),
      builtin('zai', 'zai', text('GLM Coding Plan (Z.ai)', 'GLM Coding Plan（Z.ai 国际）'), 'https://z.ai/manage-apikey/apikey-list'),
      custom('bigmodel', { label: text('Pay as you go (China)', '按量计费（中国）'), providerId: 'bigmodel', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' }),
      custom('zai-api', { label: text('Pay as you go (Z.ai)', '按量计费（Z.ai 国际）'), providerId: 'zai-api', baseUrl: 'https://api.z.ai/api/paas/v4', api: 'openai-completions', apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list' }),
    ],
  },
  {
    key: 'minimax', name: text('MiniMax'), aliases: ['minimax', '稀宇', 'hailuo', '海螺'], category: 'china', icon: 'minimax-color',
    website: 'https://www.minimax.io',
    versions: [
      builtin('minimax-cn', 'minimax-cn', CHINA, 'https://platform.minimaxi.com/user-center/basic-information/interface-key'),
      builtin('minimax', 'minimax', GLOBAL, 'https://platform.minimax.io/user-center/basic-information/interface-key'),
    ],
  },
  {
    key: 'xiaomi', name: text('Xiaomi MiMo', '小米 MiMo'), aliases: ['xiaomi', 'mimo', '小米'], category: 'china', icon: 'xiaomimimo',
    website: 'https://platform.xiaomimimo.com',
    versions: [
      builtin('xiaomi', 'xiaomi', PAY_AS_YOU_GO, 'https://platform.xiaomimimo.com/#/console/api-keys'),
      builtin('xiaomi-token-plan-cn', 'xiaomi-token-plan-cn', text('Token Plan (China)', 'Token Plan（中国）'), 'https://platform.xiaomimimo.com/#/console/plan-manage'),
      builtin('xiaomi-token-plan-sgp', 'xiaomi-token-plan-sgp', text('Token Plan (Singapore)', 'Token Plan（新加坡）'), 'https://platform.xiaomimimo.com/#/console/plan-manage'),
      builtin('xiaomi-token-plan-ams', 'xiaomi-token-plan-ams', text('Token Plan (Amsterdam)', 'Token Plan（阿姆斯特丹）'), 'https://platform.xiaomimimo.com/#/console/plan-manage'),
    ],
  },
  {
    key: 'qwen', name: text('Alibaba Cloud Model Studio (Qwen)', '阿里云百炼（通义千问）'), aliases: ['qwen', 'dashscope', 'bailian', 'model studio', 'aliyun', 'alibaba', '百炼', '通义', '千问', '阿里'], category: 'china', icon: 'bailian-color',
    website: 'https://bailian.console.aliyun.com',
    versions: [
      custom('dashscope', { label: text('Pay as you go (China)', '按量计费（中国）'), providerId: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', compat: QWEN_COMPAT, apiKeyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key' }),
      custom('dashscope-intl', { label: text('Pay as you go (International)', '按量计费（国际）'), providerId: 'dashscope-intl', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', compat: QWEN_COMPAT, apiKeyUrl: 'https://modelstudio.console.alibabacloud.com/?tab=model#/api-key' }),
      builtin('qwen-token-plan-cn', 'qwen-token-plan-cn', text('Token Plan (China)', 'Token Plan（中国）'), 'https://bailian.console.aliyun.com/?tab=model#/api-key'),
      builtin('qwen-token-plan', 'qwen-token-plan', text('Token Plan (International)', 'Token Plan（国际）'), 'https://home.qwencloud.com/api-keys'),
      builtin('qwen-token-plan-individual', 'qwen-token-plan-individual', text('Token Plan Individual', 'Token Plan 个人版'), 'https://home.qwencloud.com/api-keys'),
    ],
  },
  {
    key: 'volcengine', name: text('Volcengine Ark (Doubao)', '火山方舟（豆包）'), aliases: ['volcengine', 'ark', 'doubao', 'bytedance', '火山', '豆包', '字节'], category: 'china', icon: 'volcengine-color',
    website: 'https://www.volcengine.com/product/ark',
    versions: [
      custom('volcengine', { label: PAY_AS_YOU_GO, providerId: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' }),
      custom('volcengine-coding', { label: text('Coding Plan'), providerId: 'volcengine-coding', baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3', api: 'openai-completions', apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' }),
    ],
  },
  {
    key: 'stepfun', name: text('StepFun', '阶跃星辰'), aliases: ['stepfun', 'step', '阶跃'], category: 'china', icon: 'stepfun-color',
    website: 'https://platform.stepfun.com',
    versions: [
      custom('stepfun', { label: text('Pay as you go (China)', '按量计费（中国）'), providerId: 'stepfun', baseUrl: 'https://api.stepfun.com/v1', api: 'openai-completions', apiKeyUrl: 'https://platform.stepfun.com/interface-key' }),
      custom('stepfun-plan', { label: text('Step Plan (China)', 'Step Plan（中国）'), providerId: 'stepfun-plan', baseUrl: 'https://api.stepfun.com/step_plan/v1', api: 'openai-completions', apiKeyUrl: 'https://platform.stepfun.com/interface-key' }),
      custom('stepfun-intl', { label: text('Pay as you go (International)', '按量计费（国际）'), providerId: 'stepfun-intl', baseUrl: 'https://api.stepfun.ai/v1', api: 'openai-completions', apiKeyUrl: 'https://platform.stepfun.ai/interface-key' }),
    ],
  },
  {
    key: 'tencent', name: text('Tencent Cloud (Hunyuan)', '腾讯云（混元）'), aliases: ['tencent', 'hunyuan', 'tokenhub', '腾讯', '混元'], category: 'china', icon: 'hunyuan-color',
    website: 'https://cloud.tencent.com/product/tokenhub',
    versions: [
      custom('tencent-tokenhub', { label: text('TokenHub'), providerId: 'tencent-tokenhub', baseUrl: 'https://tokenhub.tencentmaas.com/v1', api: 'openai-completions', apiKeyUrl: 'https://console.cloud.tencent.com/tokenhub/apikey' }),
      custom('hunyuan', { label: text('Hunyuan API', '混元 API'), providerId: 'hunyuan', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', api: 'openai-completions', apiKeyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key' }),
    ],
  },
  {
    key: 'qianfan', name: text('Baidu Qianfan', '百度千帆'), aliases: ['baidu', 'qianfan', 'ernie', 'wenxin', '百度', '千帆', '文心'], category: 'china', icon: 'wenxin-color',
    website: 'https://cloud.baidu.com/product/wenxinworkshop',
    versions: [custom('qianfan', { label: text('API'), providerId: 'qianfan', baseUrl: 'https://qianfan.baidubce.com/v2', api: 'openai-completions', apiKeyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list' })],
  },
  {
    key: 'siliconflow', name: text('SiliconFlow', '硅基流动'), aliases: ['siliconflow', 'siliconcloud', '硅基'], category: 'aggregator', icon: 'siliconcloud-color',
    website: 'https://siliconflow.cn',
    versions: [
      custom('siliconflow', { label: CHINA, providerId: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', api: 'openai-completions', apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak' }),
      custom('siliconflow-intl', { label: GLOBAL, providerId: 'siliconflow-intl', baseUrl: 'https://api.siliconflow.com/v1', api: 'openai-completions', apiKeyUrl: 'https://cloud.siliconflow.com/account/ak' }),
    ],
  },
  {
    key: 'modelscope', name: text('ModelScope', '魔搭 ModelScope'), aliases: ['modelscope', '魔搭'], category: 'aggregator', icon: 'modelscope-color',
    website: 'https://modelscope.cn',
    versions: [custom('modelscope', { label: text('API Inference', 'API 推理'), providerId: 'modelscope', baseUrl: 'https://api-inference.modelscope.cn/v1', api: 'openai-completions', apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken' })],
  },
  {
    key: 'openrouter', name: text('OpenRouter'), aliases: [], category: 'aggregator', icon: 'openrouter',
    website: 'https://openrouter.ai',
    versions: [builtin('openrouter', 'openrouter', text('API'), 'https://openrouter.ai/keys')],
  },
  {
    key: 'together', name: text('Together AI'), aliases: ['together'], category: 'aggregator', icon: 'together-color',
    website: 'https://www.together.ai',
    versions: [builtin('together', 'together', text('API'), 'https://api.together.ai/settings/api-keys')],
  },
  {
    key: 'fireworks', name: text('Fireworks AI'), aliases: ['fireworks'], category: 'aggregator', icon: 'fireworks-color',
    website: 'https://fireworks.ai',
    versions: [builtin('fireworks', 'fireworks', text('API'), 'https://fireworks.ai/account/api-keys')],
  },
  {
    key: 'huggingface', name: text('Hugging Face'), aliases: ['hf', 'huggingface'], category: 'aggregator', icon: 'huggingface-color',
    website: 'https://huggingface.co',
    versions: [builtin('huggingface', 'huggingface', text('Inference Providers'), 'https://huggingface.co/settings/tokens')],
  },
  {
    key: 'nvidia', name: text('NVIDIA'), aliases: ['nim', 'build.nvidia.com'], category: 'aggregator', icon: 'nvidia-color',
    website: 'https://build.nvidia.com',
    versions: [builtin('nvidia', 'nvidia', text('NIM API'), 'https://build.nvidia.com/settings/api-keys')],
  },
  {
    key: 'vercel', name: text('Vercel AI Gateway'), aliases: ['vercel'], category: 'aggregator', icon: 'vercel',
    website: 'https://vercel.com/ai-gateway',
    versions: [builtin('vercel-ai-gateway', 'vercel-ai-gateway', text('API'), 'https://vercel.com/ai-gateway')],
  },
  {
    key: 'ollama', name: text('Ollama'), aliases: [], category: 'local', icon: 'ollama',
    website: 'https://ollama.com',
    versions: [custom('ollama', { label: text('On this computer', '本机'), providerId: 'ollama', baseUrl: 'http://localhost:11434/v1', api: 'openai-completions', local: true })],
  },
  {
    key: 'lmstudio', name: text('LM Studio'), aliases: ['lm studio', 'lmstudio'], category: 'local', icon: 'lmstudio',
    website: 'https://lmstudio.ai',
    versions: [custom('lmstudio', { label: text('On this computer', '本机'), providerId: 'lmstudio', baseUrl: 'http://localhost:1234/v1', api: 'openai-completions', local: true })],
  },
  {
    key: 'custom', name: text('Custom endpoint', '自定义地址'), aliases: ['custom', 'openai compatible', 'anthropic compatible', 'proxy', 'vllm', 'sglang', '自定义', '兼容', '中转'], category: 'custom',
    versions: [custom('custom', { label: text('OpenAI, Anthropic or Gemini compatible', 'OpenAI、Anthropic 或 Gemini 兼容'), providerId: 'custom', baseUrl: '', api: 'openai-completions' })],
  },
]

export function localizedText(value: LocalizedText, locale: string) {
  return locale.toLowerCase().startsWith('zh') ? value.zh : value.en
}

function hostname(url: string | undefined) {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return ''
  }
}

function presetTerms(preset: ProviderPreset) {
  return [
    preset.key, preset.name.en, preset.name.zh, ...preset.aliases, hostname(preset.website),
    ...preset.versions.flatMap((version) => [
      version.label.en, version.label.zh, version.providerId, hostname(version.apiKeyUrl),
      ...(version.kind === 'custom' ? [hostname(version.baseUrl)] : []),
    ]),
  ].filter(Boolean).join('\n').toLowerCase()
}

/** Every word must match a name, alias, address or provider ID. */
export function searchProviderPresets(
  presets: readonly ProviderPreset[],
  query: string,
  category: ProviderPresetCategory | 'all' = 'all',
) {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return presets.filter((preset) => (category === 'all' || preset.category === category) &&
    (words.length === 0 || words.every((word) => presetTerms(preset).includes(word))))
}

/** Endpoints compare without case in the host, a trailing slash, or a default port. */
function endpointKey(url: string | undefined) {
  if (!url) return ''
  try {
    const parsed = new URL(url.trim())
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/u, '')}`
  } catch {
    return ''
  }
}

export interface PresetMatch {
  preset: ProviderPreset
  version: ProviderPresetVersion
  /** The same Pi provider or the same address, not only the same company's domain. */
  exact: boolean
}

/** "api.siliconflow.cn" → "siliconflow.cn", "dashscope.aliyuncs.com" → "aliyuncs.com", "a.b.com.cn" → "b.com.cn". */
function siteOf(host: string) {
  const labels = host.split('.').filter(Boolean)
  const secondLevel = labels.length >= 3 && labels[labels.length - 1]!.length === 2 && ['com', 'net', 'org', 'co', 'ac'].includes(labels[labels.length - 2]!)
  return labels.slice(secondLevel ? -3 : -2).join('.')
}

/** Every address a preset reaches, its own Pi providers' included. */
function presetHosts(preset: ProviderPreset, builtinBaseUrls: Readonly<Record<string, string | undefined>>) {
  return [preset.website, ...preset.versions.map((version) => version.kind === 'custom' ? version.baseUrl : builtinBaseUrls[version.providerId])]
    .map(hostname).filter(Boolean)
}

/**
 * The preset a configured provider belongs to: Pi's provider ID, else the
 * same address, else an address on the same company's domain (for its logo
 * and name only).
 */
export function presetForProvider(
  provider: { id: string; baseUrl?: string; builtin?: boolean },
  builtinBaseUrls: Readonly<Record<string, string | undefined>> = {},
): PresetMatch | null {
  const all = PROVIDER_PRESETS.flatMap((preset) => preset.versions.map((version) => ({ preset, version })))
  if (provider.builtin) {
    const match = all.find(({ version }) => version.kind === 'builtin' && version.providerId === provider.id)
    return match ? { ...match, exact: true } : null
  }
  const endpoint = endpointKey(provider.baseUrl)
  const exact = endpoint ? all.find(({ version }) => endpointKey(version.kind === 'custom' ? version.baseUrl : builtinBaseUrls[version.providerId]) === endpoint) : undefined
  if (exact) return { ...exact, exact: true }
  const host = hostname(provider.baseUrl)
  if (!host || isLocalAddress(provider.baseUrl)) return null
  const site = siteOf(host)
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.category !== 'custom' &&
    presetHosts(candidate, builtinBaseUrls).some((candidateHost) => siteOf(candidateHost) === site))
  return preset ? { preset, version: preset.versions[0], exact: false } : null
}

/** A local server: Pi lists its models only when the provider has some key. */
export function isLocalAddress(url: string | undefined) {
  const host = hostname(url)
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.local')
}

/** Pi's providers that some preset offers. */
export const PRESET_BUILTIN_PROVIDER_IDS: ReadonlySet<string> = new Set(PROVIDER_PRESETS.flatMap((preset) =>
  preset.versions.flatMap((version) => version.kind === 'builtin' ? [version.providerId] : [])))
