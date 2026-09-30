import { cn } from "@/lib/utils"

/** macOS renders shortcuts as bare glyphs (⌘K), not as boxed keycaps. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-[18px] w-fit min-w-[18px] items-center justify-center gap-0.5 rounded-[4px] bg-fill px-1 font-sans text-micro font-medium tracking-[0.04em] text-muted-foreground select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        "[[data-slot=tooltip-content]_&]:bg-transparent [[data-slot=tooltip-content]_&]:px-0 [[data-slot=tooltip-content]_&]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
