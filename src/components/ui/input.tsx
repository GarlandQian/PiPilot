import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-[var(--control-h)] w-full rounded-md border border-input bg-input px-2.5 text-card-foreground shadow-none outline-none transition-colors duration-(--duration-fast) placeholder:text-muted-foreground/70 hover:border-muted-foreground/25 focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
