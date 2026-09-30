import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-[var(--control-h)] w-full min-w-0 rounded-md border-0 px-2 bg-control text-app text-foreground shadow-[0_0_0_0.5px_var(--color-input),inset_0_0.5px_1px_rgb(0_0_0/0.06)] outline-none transition-[box-shadow,background-color] duration-(--duration-fast) placeholder:text-muted-foreground/80 focus-visible:outline-none focus-visible:shadow-[0_0_0_0.5px_var(--color-ring),0_0_0_3.5px_color-mix(in_srgb,var(--color-ring)_45%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:shadow-[0_0_0_1px_var(--color-destructive)] dark:bg-white/5',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
