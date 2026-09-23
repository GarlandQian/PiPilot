import * as React from 'react'

interface ReadingPosition { top: number; left: number }
const retainedPositions = new WeakMap<HTMLDivElement, Map<HTMLElement, ReadingPosition>>()

/** Moving a retained DOM tree through a zero-size host can clamp native scrolling. */
function captureReadingPositions(container: HTMLDivElement) {
  const positions = retainedPositions.get(container) ?? new Map<HTMLElement, ReadingPosition>()
  for (const node of positions.keys()) {
    if (!container.contains(node)) positions.delete(node)
  }
  for (const node of container.querySelectorAll<HTMLElement>('*')) {
    if (node.scrollTop || node.scrollLeft || (
      node.clientHeight > 0 && node.clientWidth > 0 &&
      (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)
    )) positions.set(node, { top: node.scrollTop, left: node.scrollLeft })
  }
  retainedPositions.set(container, positions)
  return positions
}

/** Move one React-owned tree and restore readers when they regain layout. */
export function InspectorPortalHost({ container, expanded = false }: { container: HTMLDivElement; expanded?: boolean }) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(container)
    const positions = retainedPositions.get(container)
    const restore = () => {
      if (!positions) return
      for (const [node, position] of positions) {
        if (!container.contains(node)) {
          positions.delete(node)
        } else if (node.clientWidth > 0 && node.clientHeight > 0) {
          node.scrollTop = position.top
          node.scrollLeft = position.left
          positions.delete(node)
        }
      }
    }
    // Hidden resource readers restore only when revisited, not while a detail
    // page is covering them. Observing layout also handles the modal animation.
    const observer = new ResizeObserver(restore)
    for (const node of positions?.keys() ?? []) observer.observe(node)
    const frame = requestAnimationFrame(restore)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      captureReadingPositions(container)
      if (container.parentNode === host) host.removeChild(container)
    }
  }, [container])
  return <div ref={hostRef} className={expanded ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col' : 'flex h-full min-h-0 shrink-0 flex-col'} />
}
