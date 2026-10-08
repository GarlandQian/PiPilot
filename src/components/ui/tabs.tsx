import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * `default` is an NSSegmentedControl: a recessed track with a raised,
 * white selected segment. `line` is the borderless toolbar variant
 * (Xcode inspector tabs): plain glyph + label, accent tint when selected.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "gap-0 rounded-full bg-fill p-[2px] group-data-[orientation=horizontal]/tabs:h-7 shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.04)]",
        line: "gap-0.5 bg-transparent group-data-[orientation=horizontal]/tabs:h-8",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-caption font-medium whitespace-nowrap text-foreground/75 transition-[color,background-color,box-shadow] duration-(--duration-fast) group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        // segmented control
        "group-data-[variant=default]/tabs-list:data-[state=active]:bg-control group-data-[variant=default]/tabs-list:data-[state=active]:text-foreground group-data-[variant=default]/tabs-list:data-[state=active]:shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.9),0_0_0_0.5px_rgb(0_0_0/0.1),0_1px_3px_rgb(0_0_0/0.14)] dark:group-data-[variant=default]/tabs-list:data-[state=active]:bg-white/22 dark:group-data-[variant=default]/tabs-list:data-[state=active]:shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.2),0_0_0_0.5px_rgb(0_0_0/0.5),0_1px_3px_rgb(0_0_0/0.3)]",
        // borderless toolbar tabs
        "group-data-[variant=line]/tabs-list:rounded-md group-data-[variant=line]/tabs-list:hover:bg-fill group-data-[variant=line]/tabs-list:data-[state=active]:bg-fill-strong group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground group-data-[variant=line]/tabs-list:data-[state=active]:[&_svg]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
