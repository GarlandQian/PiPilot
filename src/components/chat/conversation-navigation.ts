import type { ConversationOutlineItem } from '@/types/chat'

/** Search never changes chronology or mutates the authoritative turn projection. */
export function filterConversationNavigationItems(
  items: readonly ConversationOutlineItem[],
  query = '',
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  return [...items].reverse().filter((item) => {
    const text = `${item.title} ${item.summary ?? ''}`.toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
}

export function conversationNavigationFocusIndex(key: string, currentIndex: number, itemCount: number) {
  if (itemCount <= 0) return null
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  if (key === 'ArrowDown') return Math.min(itemCount - 1, currentIndex + 1)
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  return null
}
