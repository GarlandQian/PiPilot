import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[20px] w-[34px] shrink-0 items-center rounded-full bg-fill-strong shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.06),inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors duration-(--duration-base) ease-standard outline-none focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:bg-primary data-[state=checked]:shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] dark:data-[state=unchecked]:bg-white/16',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-[18px] w-[18px] translate-x-px rounded-full bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.08),0_1px_2.5px_rgb(0_0_0/0.28)] transition-transform duration-(--duration-base) ease-spring data-[state=checked]:translate-x-[15px] dark:bg-[#f2f2f2]" />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
