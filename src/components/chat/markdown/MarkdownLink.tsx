import * as React from 'react'
import { isSafeExternalUrl } from '@/shared/external-url'

export function sanitizeHref(href?: string): string | undefined {
  return href && isSafeExternalUrl(href) ? href : undefined
}

export function openExternal(href: string) {
  if (window.pipilot) {
    void window.pipilot.shell.openExternal(href).catch(() => undefined)
    return
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}

interface MarkdownLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  children?: React.ReactNode
}

export function MarkdownLink({ href, children, ...rest }: MarkdownLinkProps) {
  const safe = sanitizeHref(href)
  if (!safe) {
    // Dangerous or invalid protocol: render as plain text, keep the label visible.
    return <span className="text-muted-foreground line-through decoration-muted-foreground/50">{children}</span>
  }
  return (
    <a
      {...rest}
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      className="rounded-sm text-sage underline decoration-sage/50 underline-offset-[3px] transition-colors duration-(--duration-fast) hover:decoration-sage focus-visible:focus-ring"
      onClick={(e) => {
        e.preventDefault()
        openExternal(safe)
      }}
    >
      {children}
    </a>
  )
}
