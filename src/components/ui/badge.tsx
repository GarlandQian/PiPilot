import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex h-[18px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-[7px] text-micro font-medium whitespace-nowrap transition-colors duration-(--duration-fast) focus-visible:focus-ring aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:brightness-105",
        secondary:
          "bg-fill-strong text-secondary-foreground [a&]:hover:bg-fill-strong/80",
        destructive:
          "bg-destructive text-destructive-foreground [a&]:hover:brightness-105",
        outline:
          "border-border text-muted-foreground [a&]:hover:bg-fill [a&]:hover:text-foreground",
        ghost: "text-muted-foreground [a&]:hover:bg-fill [a&]:hover:text-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        "soft-success": "bg-success/14 text-success [a&]:hover:bg-success/22",
        "soft-warning": "bg-warning/14 text-warning [a&]:hover:bg-warning/22",
        "soft-danger": "bg-destructive/12 text-destructive [a&]:hover:bg-destructive/20",
        "soft-info": "bg-info/12 text-info [a&]:hover:bg-info/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
