/**
 * Shared macOS 27 menu look for dropdown, context, select and command menus:
 * Liquid Glass material, concentric rounded rows, accent highlight with white text.
 */
export const menuContentClass =
  'material z-50 overflow-x-hidden overflow-y-auto rounded-[14px] p-[6px] text-popover-foreground shadow-popover outline-none'

export const menuItemClass = [
  'relative flex min-h-[26px] cursor-default items-center gap-2 rounded-[8px] px-2.5 py-[3px] text-app leading-tight outline-hidden select-none',
  'data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
  'data-[highlighted]:[&_svg]:text-primary-foreground! data-[highlighted]:[&_.text-muted-foreground]:text-primary-foreground/80',
].join(' ')

export const menuLabelClass = 'px-2.5 pt-1.5 pb-0.5 text-micro font-semibold text-muted-foreground'

export const menuSeparatorClass = 'mx-2.5 my-[5px] h-px bg-border'

export const menuShortcutClass =
  'ml-auto pl-5 text-caption tracking-[0.06em] text-muted-foreground in-data-[highlighted]:text-primary-foreground/80'
