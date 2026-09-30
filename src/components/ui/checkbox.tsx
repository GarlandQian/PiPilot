import * as React from "react"
import { TbCheck } from "react-icons/tb"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-[15px] shrink-0 rounded-[4px] bg-control shadow-[0_0_0_0.5px_var(--color-input),0_0.5px_1px_rgb(0_0_0/0.1)] transition-[background-color,box-shadow] duration-(--duration-fast) outline-none focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:shadow-[0_0_0_1px_var(--color-destructive)] data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.25),0_0_0_0.5px_rgb(0_0_0/0.1)] dark:data-[state=unchecked]:bg-white/8",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <TbCheck className="size-3 stroke-[3.5]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
