import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * macOS-style slider: a thin track filled with the accent colour and a white
 * knob. `ticks` draws one mark per step, like a stepped NSSlider.
 */
function Slider({
  className,
  ticks,
  thumbLabel,
  thumbValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  ticks?: number
  /** Accessible name of the knob, which is the element with role="slider". */
  thumbLabel?: string
  thumbValueText?: string
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-45', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-fill-strong">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      {ticks && ticks > 1 ? (
        // Marks sit under the knob's travel: the knob centre spans the track minus its own width.
        <span aria-hidden className="pointer-events-none absolute inset-x-[10px] top-1/2 flex -translate-y-1/2 justify-between">
          {Array.from({ length: ticks }, (_, index) => (
            <span key={index} className="h-2 w-px rounded-full bg-muted-foreground/45" />
          ))}
        </span>
      ) : null}
      <SliderPrimitive.Thumb
        aria-label={thumbLabel}
        aria-valuetext={thumbValueText}
        className="block size-5 rounded-full bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_1px_3px_rgb(0_0_0/0.25)] outline-none transition-[box-shadow] focus-visible:shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_0_0_3px_color-mix(in_srgb,var(--color-ring)_50%,transparent)] motion-reduce:transition-none"
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
