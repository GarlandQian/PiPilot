import {
  piHostEventEnvelopeSchema,
  type PiHostEventEnvelope,
} from './pi-host-protocol'
import {
  localPiRpcEventSchema,
  type LocalPiRpcEvent,
} from './local-pi'

const event = localPiRpcEventSchema

/**
 * Shared projection helpers for events produced by the embedded Pi Host.
 *
 * Main may receive raw Host `event` envelopes that carry any DTO the Pi SDK
 * emits. Structure them before they cross Renderer IPC by validating against
 * the existing official-DTO shape; unknown event kinds stay visible as
 * closed `processing` events so unexpected SDK growth never breaks the renderer.
 */

/* A structured event whose type is recognized by the shared RPC contract. */
export function parsePiHostEventPayload(
  payload: unknown,
): LocalPiRpcEvent | null {
  const result = event.safeParse(payload)
  return result.success ? result.data : null
}

/* Whether a Host envelope is worth forwarding to the renderer at all. */
export function isForwardablePiHostEvent(envelope: PiHostEventEnvelope) {
  return piHostEventEnvelopeSchema.safeParse(envelope).success
}

/* Stable name used by Main projections when a payload is not a known event. */
export const PI_HOST_UNKNOWN_EVENT_TYPE = 'processing' as const