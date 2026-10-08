import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { menuContentClass, menuItemClass, menuSeparatorClass } from './menu-styles'

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  onKeyDown,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
          return
        }
        event.preventDefault()
        const target = event.currentTarget
        const bounds = target.getBoundingClientRect()
        const EventConstructor = target.ownerDocument.defaultView?.MouseEvent ?? MouseEvent
        target.dispatchEvent(new EventConstructor('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + Math.min(16, bounds.width / 2),
          clientY: bounds.top + Math.min(20, bounds.height),
          view: target.ownerDocument.defaultView,
        }))
      }}
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        collisionPadding={collisionPadding}
        className={cn(
          menuContentClass,
          'max-h-(--radix-context-menu-content-available-height) min-w-[200px] origin-(--radix-context-menu-content-transform-origin) motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

/** Same rows as DropdownMenuItem, so a row's ⋯ menu and right-click menu look alike. */
function ContextMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  variant?: 'default' | 'destructive'
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(
        menuItemClass,
        'data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:text-destructive! data-[variant=destructive]:data-[highlighted]:bg-destructive data-[variant=destructive]:data-[highlighted]:text-white data-[variant=destructive]:data-[highlighted]:*:[svg]:text-white!',
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(menuSeparatorClass, className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
}
