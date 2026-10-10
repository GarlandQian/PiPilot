import { cn } from '@/lib/utils'
// Brand logos from @lobehub/icons-static-svg (MIT). Each is its own image, so
// gradient IDs inside one SVG never collide with another copy on the page.
import bailian from '@lobehub/icons-static-svg/icons/bailian-color.svg'
import cerebras from '@lobehub/icons-static-svg/icons/cerebras-color.svg'
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import fireworks from '@lobehub/icons-static-svg/icons/fireworks-color.svg'
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg'
import groq from '@lobehub/icons-static-svg/icons/groq.svg'
import huggingface from '@lobehub/icons-static-svg/icons/huggingface-color.svg'
import hunyuan from '@lobehub/icons-static-svg/icons/hunyuan-color.svg'
import kimi from '@lobehub/icons-static-svg/icons/kimi.svg'
import lmstudio from '@lobehub/icons-static-svg/icons/lmstudio.svg'
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg'
import modelscope from '@lobehub/icons-static-svg/icons/modelscope-color.svg'
import nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg'
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg'
import siliconcloud from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg'
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg'
import together from '@lobehub/icons-static-svg/icons/together-color.svg'
import vercel from '@lobehub/icons-static-svg/icons/vercel.svg'
import volcengine from '@lobehub/icons-static-svg/icons/volcengine-color.svg'
import wenxin from '@lobehub/icons-static-svg/icons/wenxin-color.svg'
import xai from '@lobehub/icons-static-svg/icons/xai.svg'
import xiaomimimo from '@lobehub/icons-static-svg/icons/xiaomimimo.svg'
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg'

const ICONS: Readonly<Record<string, string>> = {
  'bailian-color': bailian,
  'cerebras-color': cerebras,
  'claude-color': claude,
  'deepseek-color': deepseek,
  'fireworks-color': fireworks,
  'gemini-color': gemini,
  groq,
  'huggingface-color': huggingface,
  'hunyuan-color': hunyuan,
  kimi,
  lmstudio,
  'minimax-color': minimax,
  'mistral-color': mistral,
  'modelscope-color': modelscope,
  'nvidia-color': nvidia,
  ollama,
  openai,
  openrouter,
  'siliconcloud-color': siliconcloud,
  'stepfun-color': stepfun,
  'together-color': together,
  vercel,
  'volcengine-color': volcengine,
  'wenxin-color': wenxin,
  xai,
  xiaomimimo,
  'zhipu-color': zhipu,
}

/** Tints for providers without a logo, picked by name so each keeps its own. */
const TINTS = ['#5E7CE2', '#3FA27A', '#C9772F', '#A05BC9', '#D25A6A', '#3E95B5', '#7C8A3A', '#8064D6']

function initials(name: string) {
  const words = name.trim().split(/[\s\-_./]+/u).filter(Boolean)
  const first = [...(words[0] ?? '?')]
  // One CJK character reads as a whole name; Latin names take two initials.
  if (/\p{Script=Han}/u.test(first[0] ?? '')) return first[0]!
  return (words.length > 1 ? `${first[0]}${[...words[1]!][0]}` : first.slice(0, 2).join('')).toUpperCase()
}

function tint(name: string) {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  return TINTS[hash % TINTS.length]
}

const SIZES = {
  xs: 'size-4 rounded-[4px] text-[7px]',
  sm: 'size-6 rounded-[7px] text-[10px]',
  row: 'size-8 rounded-[9px] text-[12px]',
  md: 'size-9 rounded-[10px] text-[13px]',
  lg: 'size-12 rounded-[13px] text-[17px]',
} as const

/** A provider's logo on a white tile (so dark logos stay visible in dark mode), or its initials. */
export function ProviderIcon({ icon, name, size = 'md', className }: {
  icon?: string
  name: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const src = icon ? ICONS[icon] : undefined
  return <span aria-hidden className={cn(
    'flex shrink-0 select-none items-center justify-center font-semibold',
    src ? 'bg-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.12),0_0.5px_1px_rgb(0_0_0/0.08)] dark:shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.2)]'
      : 'text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.18),transparent)]',
    SIZES[size], className,
  )} style={src ? undefined : { backgroundColor: tint(name) }}>
    {src ? <img src={src} alt="" draggable={false} className="size-[62%] object-contain" /> : initials(name)}
  </span>
}
