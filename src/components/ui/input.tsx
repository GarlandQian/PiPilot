import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-[var(--control-h)] w-full min-w-0 rounded-md border border-input bg-surface px-2.5 text-app text-foreground shadow-none outline-none transition-colors duration-(--duration-fast) placeholder:text-muted-foreground hover:border-muted-foreground/60 focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
