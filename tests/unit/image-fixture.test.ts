import { crc32, inflateSync } from 'node:zlib'
import { resizeImage } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'

describe('real image fixture', () => {
  it('has valid PNG chunks and decodable pixels for strict native image decoders', () => {
    const image = Buffer.from(PNG_FIXTURE_BASE64, 'base64')
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const pixels: Buffer[] = []
    for (let offset = 8; offset < image.length;) {
      const length = image.readUInt32BE(offset)
      const type = image.toString('ascii', offset + 4, offset + 8)
      const payload = image.subarray(offset + 4, offset + 8 + length)
      expect(crc32(payload), `${type} CRC`).toBe(image.readUInt32BE(offset + 8 + length))
      if (type === 'IDAT') pixels.push(image.subarray(offset + 8, offset + 8 + length))
      offset += length + 12
    }
    expect(inflateSync(Buffer.concat(pixels))).toHaveLength(2 * (1 + 2 * 4))
  })

  it('survives the official Pi image processor unchanged and supports actual resizing', async () => {
    const image = Buffer.from(PNG_FIXTURE_BASE64, 'base64')
    await expect(resizeImage(image, 'image/png')).resolves.toMatchObject({
      data: PNG_FIXTURE_BASE64, width: 2, height: 2, wasResized: false,
    })
    await expect(resizeImage(image, 'image/png', { maxWidth: 1, maxHeight: 1 })).resolves.toMatchObject({
      width: 1, height: 1, originalWidth: 2, originalHeight: 2, wasResized: true,
    })
  })
})
