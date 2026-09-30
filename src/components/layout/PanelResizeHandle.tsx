import * as React from 'react'
import { cn } from '@/lib/utils'

interface PanelResizeHandleProps {
  width: number
  min: number
  max: number
  defaultWidth: number
  label: string
  /** positive dx means dragging towards the panel (making it wider for a right-side panel) */
  onChange: (width: number) => void
  side?: 'right' | 'left'
}

export function PanelResizeHandle({ width, min, max, defaultWidth, label, onChange, side = 'right' }: PanelResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false)

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setDragging(true)
    const onMove = (ev: PointerEvent) => {
      const delta = side === 'right' ? startX - ev.clientX : ev.clientX - startX
      onChange(clamp(startW + delta))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onChange(clamp(width + (side === 'right' ? step : -step)))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(clamp(width + (side === 'right' ? -step : step)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(defaultWidth)
    }
  }

  // macOS split views have no visible grabber: the panes' own hairline border
  // is the divider and a slim invisible hit area straddles it.
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(defaultWidth)}
      data-dragging={dragging || undefined}
      className="group relative z-20 w-0 shrink-0 cursor-col-resize outline-none"
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 -left-[3px] w-[6px] cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-[2.5px] after:w-px after:bg-transparent after:transition-colors after:duration-(--duration-fast)',
          'group-focus-visible:after:bg-ring group-data-[dragging]:after:bg-ring/70',
        )}
      />
    </div>
  )
}
