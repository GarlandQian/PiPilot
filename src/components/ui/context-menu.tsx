import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { menuContentClass, menuItemClass } from './menu-styles'

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
          'max-h-(--radix-context-menu-content-available-height) min-w-48 origin-(--radix-context-menu-content-transform-origin) motion-reduce:animate-none',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        menuItemClass,
        '[&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
}
