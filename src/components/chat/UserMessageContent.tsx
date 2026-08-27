import * as React from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { UserMessageImage } from '@/types/chat'

const DISPLAYABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])
const MAX_DISPLAY_IMAGE_DATA_CHARS = 16 * 1024 * 1024
const BASE64_IMAGE_DATA = /^[A-Za-z0-9+/]+={0,2}$/u

export function userMessageImageSource(image: UserMessageImage): string | null {
  if (
    !DISPLAYABLE_IMAGE_TYPES.has(image.mimeType) ||
    image.data.length === 0 ||
    image.data.length > MAX_DISPLAY_IMAGE_DATA_CHARS ||
    image.data.length % 4 === 1 ||
    !BASE64_IMAGE_DATA.test(image.data)
  ) {
    return null
  }
  return `data:${image.mimeType};base64,${image.data}`
}

interface UserMessageContentProps {
  text: string
  images?: readonly UserMessageImage[]
}

export const UserMessageContent = React.memo(function UserMessageContent({
  text,
  images = [],
}: UserMessageContentProps) {
  const t = useT()
  return (
    <div className={cn('space-y-2', !text && 'space-y-0')}>
      {text ? (
        <p className="text-app whitespace-pre-wrap break-words text-foreground">
          {text}
        </p>
      ) : null}
      {images.length > 0 ? (
        <div
          className={cn(
            'grid w-fit max-w-[32rem] gap-1.5',
            images.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
          )}
          data-user-message-images
        >
          {images.map((image) => {
            const src = userMessageImageSource(image)
            return (
              <div
                key={image.id}
                className="flex min-h-12 min-w-12 max-w-full items-center justify-center overflow-hidden rounded-md border border-border/80 bg-background/60"
              >
                {src ? (
                  <img
                    src={src}
                    alt={t('md.image')}
                    loading="lazy"
                    decoding="async"
                    className="h-auto max-h-72 max-w-full object-contain"
                    data-user-message-image
                  />
                ) : (
                  <span className="px-3 py-6 text-micro text-muted-foreground">
                    [{t('md.image')}]
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
})
