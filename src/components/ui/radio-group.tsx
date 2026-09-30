"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group/radio inline-flex aspect-square size-[15px] shrink-0 items-center justify-center rounded-full bg-control shadow-[0_0_0_0.5px_var(--color-input),0_0.5px_1px_rgb(0_0_0/0.1)] transition-[background-color,box-shadow] duration-(--duration-fast) outline-none focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:shadow-[0_0_0_1px_var(--color-destructive)] data-[state=checked]:bg-primary data-[state=checked]:shadow-[inset_0_0.5px_0_rgb(255_255_255/0.25),0_0_0_0.5px_rgb(0_0_0/0.1)] dark:data-[state=unchecked]:bg-white/8",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span className="size-1.5 rounded-full bg-white" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
