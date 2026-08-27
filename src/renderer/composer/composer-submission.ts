import type { LocalPiImageContent } from '@/shared/local-pi'
import type { ComposerSendShortcut } from '@/shared/settings'

export const COMPOSER_IMAGE_COUNT_LIMIT = 8
export const COMPOSER_IMAGE_BYTE_LIMIT = 10 * 1024 * 1024
export const COMPOSER_IMAGE_TOTAL_BYTE_LIMIT = 32 * 1024 * 1024

export type ComposerImageValidationError =
  | 'unsupported-type'
  | 'file-too-large'
  | 'too-many-files'
  | 'total-too-large'
  | 'duplicate-file'

export interface ComposerImageAttachment {
  id: string
  key: string
  file: File
  previewUrl: string
}

export function isComposerSendShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  shortcut: ComposerSendShortcut,
) {
  if (event.key !== 'Enter' || event.altKey || event.shiftKey) return false
  const modified = event.ctrlKey || event.metaKey
  return shortcut === 'enter' ? !modified : modified
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

export function composerImageKey(file: File) {
  return `${file.name}\0${file.size}\0${file.lastModified}\0${file.type}`
}

export function validateComposerImageBatch(
  current: readonly Pick<ComposerImageAttachment, 'key' | 'file'>[],
  incoming: readonly File[],
): ComposerImageValidationError | null {
  if (current.length + incoming.length > COMPOSER_IMAGE_COUNT_LIMIT) {
    return 'too-many-files'
  }

  const keys = new Set(current.map((attachment) => attachment.key))
  let totalBytes = current.reduce((sum, attachment) => sum + attachment.file.size, 0)
  for (const file of incoming) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return 'unsupported-type'
    if (file.size > COMPOSER_IMAGE_BYTE_LIMIT) return 'file-too-large'
    const key = composerImageKey(file)
    if (keys.has(key)) return 'duplicate-file'
    keys.add(key)
    totalBytes += file.size
  }
  if (totalBytes > COMPOSER_IMAGE_TOTAL_BYTE_LIMIT) return 'total-too-large'
  return null
}

function bytesToBase64(bytes: Uint8Array) {
  const chunks: string[] = []
  const chunkSize = 32_768
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)))
  }
  return btoa(chunks.join(''))
}

export async function attachmentToPiImage(
  attachment: Pick<ComposerImageAttachment, 'file'>,
): Promise<LocalPiImageContent> {
  return {
    type: 'image',
    data: bytesToBase64(new Uint8Array(await attachment.file.arrayBuffer())),
    mimeType: attachment.file.type,
  }
}

export async function attachmentsToPiImagesIfCurrent(
  attachments: readonly Pick<ComposerImageAttachment, 'file'>[],
  isCurrent: () => boolean,
): Promise<LocalPiImageContent[] | null> {
  const images = await Promise.all(attachments.map(attachmentToPiImage))
  return isCurrent() ? images : null
}
