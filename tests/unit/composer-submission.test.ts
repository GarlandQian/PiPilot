import { describe, expect, it } from 'vitest'
import {
  attachmentsToPiImagesIfCurrent,
  COMPOSER_IMAGE_BYTE_LIMIT,
  COMPOSER_IMAGE_COUNT_LIMIT,
  COMPOSER_IMAGE_TOTAL_BYTE_LIMIT,
  composerImageKey,
  isComposerSendShortcut,
  validateComposerImageBatch,
} from '../../src/renderer/composer/composer-submission'

function image(
  name: string,
  size: number,
  type = 'image/png',
  lastModified = 1,
) {
  return { name, size, type, lastModified } as File
}

function keyboardEvent(
  overrides: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>> = {},
) {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'Enter',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('composer send shortcut', () => {
  it('sends with plain Enter by default while Shift+Enter stays a line break', () => {
    expect(isComposerSendShortcut(keyboardEvent(), 'enter')).toBe(true)
    expect(isComposerSendShortcut(keyboardEvent({ shiftKey: true }), 'enter')).toBe(false)
    expect(isComposerSendShortcut(keyboardEvent({ ctrlKey: true }), 'enter')).toBe(false)
    expect(isComposerSendShortcut(keyboardEvent({ metaKey: true }), 'enter')).toBe(false)
  })

  it('supports Ctrl or Command plus Enter without consuming line-break chords', () => {
    expect(isComposerSendShortcut(keyboardEvent(), 'mod-enter')).toBe(false)
    expect(isComposerSendShortcut(keyboardEvent({ ctrlKey: true }), 'mod-enter')).toBe(true)
    expect(isComposerSendShortcut(keyboardEvent({ metaKey: true }), 'mod-enter')).toBe(true)
    expect(isComposerSendShortcut(
      keyboardEvent({ ctrlKey: true, shiftKey: true }),
      'mod-enter',
    )).toBe(false)
    expect(isComposerSendShortcut(
      keyboardEvent({ altKey: true, ctrlKey: true }),
      'mod-enter',
    )).toBe(false)
  })
})

describe('composer image batch validation', () => {
  it('accepts supported images and rejects the whole invalid batch', () => {
    expect(validateComposerImageBatch([], [image('one.png', 100)])).toBeNull()
    expect(validateComposerImageBatch([], [
      image('one.png', 100),
      image('notes.txt', 20, 'text/plain'),
    ])).toBe('unsupported-type')
    expect(validateComposerImageBatch([], [
      image('large.jpg', COMPOSER_IMAGE_BYTE_LIMIT + 1, 'image/jpeg'),
    ])).toBe('file-too-large')
  })

  it('discards delayed image conversion after the composer scope changes', async () => {
    let current = true
    let release: ((value: ArrayBuffer) => void) | undefined
    const file = {
      type: 'image/png',
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => {
        release = resolve
      }),
    } as File
    const conversion = attachmentsToPiImagesIfCurrent(
      [{ file }],
      () => current,
    )

    current = false
    release?.(Uint8Array.from([1, 2, 3]).buffer)

    await expect(conversion).resolves.toBeNull()
  })

  it('enforces count, total size, and duplicate identity across batches', () => {
    const existingFile = image('same.png', 100)
    const existing = [{ key: composerImageKey(existingFile), file: existingFile }]
    expect(validateComposerImageBatch(existing, [existingFile])).toBe('duplicate-file')
    expect(validateComposerImageBatch(
      [],
      Array.from({ length: COMPOSER_IMAGE_COUNT_LIMIT + 1 }, (_, index) =>
        image(`${index}.png`, 1, 'image/png', index)),
    )).toBe('too-many-files')
    expect(validateComposerImageBatch([], [
      image('one.png', COMPOSER_IMAGE_TOTAL_BYTE_LIMIT / 2 + 1),
      image('two.png', COMPOSER_IMAGE_TOTAL_BYTE_LIMIT / 2),
    ])).toBe('file-too-large')
    expect(validateComposerImageBatch(
      Array.from({ length: 3 }, (_, index) => {
        const file = image(`${index}.png`, 8 * 1024 * 1024, 'image/png', index)
        return { key: composerImageKey(file), file }
      }),
      [image('next.png', 9 * 1024 * 1024)],
    )).toBe('total-too-large')
  })
})
