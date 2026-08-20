import * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={label}
          aria-valuenow={width}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => onChange(defaultWidth)}
          data-dragging={dragging || undefined}
          className="group relative w-1 shrink-0 cursor-col-resize outline-none"
        >
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors duration-(--duration-fast)',
              'group-hover:bg-ring/60 group-focus-visible:bg-ring/60',
              'group-data-[dragging]:bg-sage',
            )}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}
