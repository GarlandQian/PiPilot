import * as React from 'react'
import { PatchDiff, Virtualizer } from '@pierre/diffs/react'
import { useSettings } from '@/store/settings'
import { resolveMonoFontStack } from '@/types/settings'
import {
  createReadOnlyDiffOptions,
  createReadOnlyDiffStyle,
  type ReadOnlyDiffThemeType,
} from './read-only-diff-options'

function readThemeType(): ReadOnlyDiffThemeType {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function useThemeType(): ReadOnlyDiffThemeType {
  const [themeType, setThemeType] = React.useState<ReadOnlyDiffThemeType>(readThemeType)

  React.useEffect(() => {
    const root = document.documentElement
    const update = () => setThemeType(readThemeType())
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  return themeType
}

export function ReadOnlyPatchDiff({ patch }: { patch: string }) {
  const settings = useSettings()
  const themeType = useThemeType()
  const { appearance } = settings
  const options = React.useMemo(
    () => createReadOnlyDiffOptions({
      themeType,
      wordWrap: appearance.wordWrap,
      showLineNumbers: appearance.showLineNumbers,
    }),
    [appearance.showLineNumbers, appearance.wordWrap, themeType],
  )
  const style = React.useMemo(
    () => createReadOnlyDiffStyle(
      appearance,
      resolveMonoFontStack(appearance.monoFontFamily),
    ),
    [appearance],
  )

  return (
    <PatchDiff
      patch={patch}
      options={options}
      style={style}
      disableWorkerPool
    />
  )
}

interface ReadOnlyDiffVirtualizerProps {
  children: React.ReactNode
  onScrollRoot: (root: HTMLElement | null) => void
}

export function ReadOnlyDiffVirtualizer({
  children,
  onScrollRoot,
}: ReadOnlyDiffVirtualizerProps) {
  const hostRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const root = hostRef.current?.firstElementChild
    const scrollRoot = root instanceof HTMLElement ? root : null
    onScrollRoot(scrollRoot)
    return () => onScrollRoot(null)
  }, [onScrollRoot])

  return (
    <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden">
      <Virtualizer
        className="scroll-slim h-full min-h-0 overflow-auto overscroll-contain"
        contentClassName="min-w-0 pb-2"
      >
        {children}
      </Virtualizer>
    </div>
  )
}
