import {
  EXTERNAL_CONTROL_MAX_FRAME_BYTES,
  ExternalControlError,
  assertExternalControlDto,
} from '../../shared/external-control'

export function encodeExternalControlFrame(value: unknown) {
  assertExternalControlDto(value)
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  if (body.byteLength === 0 || body.byteLength > EXTERNAL_CONTROL_MAX_FRAME_BYTES) {
    throw new ExternalControlError(
      'request_too_large',
      'The external-control frame is too large.',
    )
  }
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(body.byteLength)
  return Buffer.concat([header, body])
}

export class ExternalControlFrameDecoder {
  private pending = Buffer.alloc(0)

  push(chunk: Buffer | Uint8Array): unknown[] {
    const incoming = Buffer.from(chunk)
    const frames: unknown[] = []
    let offset = 0
    while (offset < incoming.byteLength) {
      if (this.pending.byteLength < 4) {
        const headerBytes = Math.min(4 - this.pending.byteLength, incoming.byteLength - offset)
        this.pending = Buffer.concat([
          this.pending,
          incoming.subarray(offset, offset + headerBytes),
        ])
        offset += headerBytes
        if (this.pending.byteLength < 4) break
      }
      const length = this.pending.readUInt32BE(0)
      if (length === 0 || length > EXTERNAL_CONTROL_MAX_FRAME_BYTES) {
        throw new ExternalControlError(
          'request_too_large',
          'The external-control frame length is invalid.',
        )
      }
      const bodyBytes = Math.min(
        length + 4 - this.pending.byteLength,
        incoming.byteLength - offset,
      )
      if (bodyBytes > 0) {
        this.pending = Buffer.concat([
          this.pending,
          incoming.subarray(offset, offset + bodyBytes),
        ])
        offset += bodyBytes
      }
      if (this.pending.byteLength < length + 4) break
      const body = this.pending.subarray(4, length + 4)
      this.pending = Buffer.alloc(0)
      try {
        const value = JSON.parse(body.toString('utf8')) as unknown
        assertExternalControlDto(value)
        frames.push(value)
      } catch (error) {
        if (error instanceof ExternalControlError) throw error
        throw new ExternalControlError(
          'invalid_state',
          'The external-control frame is malformed.',
        )
      }
    }
    return frames
  }
}
