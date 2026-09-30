import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-app font-normal whitespace-nowrap select-none transition-[color,background-color,box-shadow,opacity,filter] duration-(--duration-fast) ease-standard outline-none focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-45 aria-invalid:shadow-[0_0_0_1px_var(--color-destructive)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // macOS 27 prominent (accent) capsule with a glassy specular rim
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.35),inset_0_-0.5px_0.5px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.18)] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.12),transparent)] hover:brightness-[1.06] active:brightness-95",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.3),0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_3px_rgb(0_0_0/0.18)] hover:brightness-[1.06] active:brightness-95",
        // bordered capsule push button (glass rim over an opaque control fill)
        outline:
          "bg-control text-foreground shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.9),0_0_0_0.5px_rgb(0_0_0/0.15),0_1px_2.5px_rgb(0_0_0/0.1)] hover:bg-[color-mix(in_srgb,var(--color-control)_93%,var(--color-foreground))] active:bg-[color-mix(in_srgb,var(--color-control)_85%,var(--color-foreground))] dark:shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.16),0_0_0_0.5px_rgb(0_0_0/0.6),0_1px_2.5px_rgb(0_0_0/0.3)] dark:hover:bg-white/18 dark:active:bg-white/24",
        // borderless fill (glass toolbar item)
        secondary:
          "bg-fill text-secondary-foreground hover:bg-fill-strong active:bg-[color-mix(in_srgb,var(--color-fill-strong)_100%,var(--color-foreground)_6%)]",
        // borderless toolbar / sidebar button
        ghost:
          "text-foreground/80 hover:bg-fill hover:text-foreground active:bg-fill-strong data-[state=open]:bg-fill-strong data-[state=open]:text-foreground",
        link: "text-primary hover:underline underline-offset-3",
        accent:
          "bg-primary text-primary-foreground shadow-[inset_0_0.5px_0_rgb(255_255_255/0.28),0_0.5px_1.5px_rgb(0_0_0/0.2)] hover:brightness-[1.06] active:brightness-95",
      },
      size: {
        default: "h-(--control-h) px-3.5 has-[>svg]:px-3",
        xs: "h-[22px] gap-1 px-2.5 text-caption has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-[26px] gap-1.5 px-3 text-app has-[>svg]:px-2.5",
        lg: "h-9 px-5 has-[>svg]:px-4",
        icon: "size-(--control-h)",
        "icon-xs": "size-[22px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-[17px]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
