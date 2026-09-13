import * as React from 'react'

/** Move the portal's DOM host without replacing its React-owned reading state. */
export function InspectorPortalHost({ container }: { container: HTMLDivElement }) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(container)
    return () => {
      if (container.parentNode === host) host.removeChild(container)
    }
  }, [container])
  return <div ref={hostRef} className="flex h-full min-h-0 shrink-0 flex-col" />
}
