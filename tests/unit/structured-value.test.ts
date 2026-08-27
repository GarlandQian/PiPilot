import { describe, expect, it } from 'vitest'
import {
  projectPlainText,
  projectStructuredValue,
  readOwnDataProperty,
} from '../../src/renderer/pi-rpc/structured-value'

describe('bounded structured value projection', () => {
  it('projects JSON-shaped values into bounded semantic nodes and copy text', () => {
    const projection = projectStructuredValue({
      name: 'PiPilot',
      enabled: true,
      nested: { count: 2 },
    })

    expect(projection).toMatchObject({
      kind: 'object',
      valueKind: 'object',
      summary: '{3}',
      truncated: false,
      malformed: false,
      unsupported: false,
    })
    expect(projection.nodes[0]).toMatchObject({
      kind: 'object',
      children: [
        { kind: 'scalar', label: 'name', value: 'PiPilot' },
        { kind: 'scalar', label: 'enabled', value: 'true' },
        { kind: 'object', label: 'nested', summary: '{1}' },
      ],
    })
    expect(JSON.parse(projection.copyText)).toEqual({
      name: 'PiPilot',
      enabled: true,
      nested: { count: 2 },
    })
  })

  it('distinguishes valid JSON text, malformed JSON-like text, and plain text', () => {
    const source = ' {"items":[1,2],"ok":true}\n'
    expect(projectStructuredValue(source)).toMatchObject({
      kind: 'json',
      valueKind: 'object',
      copyText: source,
      malformed: false,
    })
    expect(projectStructuredValue('{not-json')).toMatchObject({
      kind: 'malformed',
      summary: '<invalid JSON>',
      copyText: '{not-json',
      malformed: true,
    })
    expect(projectStructuredValue('ordinary output')).toMatchObject({
      kind: 'text',
      summary: 'ordinary output',
      copyText: 'ordinary output',
    })
    expect(projectStructuredValue('123 files processed')).toMatchObject({
      kind: 'text',
      summary: '123 files processed',
      malformed: false,
    })
    expect(projectStructuredValue('')).toMatchObject({
      kind: 'empty',
      copyText: '',
    })
    expect(projectPlainText('{ shell block; }')).toMatchObject({
      kind: 'text',
      summary: '{ shell block; }',
      malformed: false,
    })
    const emoji = projectPlainText('🚀🚀', { maxStringBytes: 7, maxCopyBytes: 7 })
    expect(emoji.nodes[0]).toEqual({ kind: 'scalar', value: '🚀…' })
    expect(emoji.copyText).toBe('🚀…')
  })

  it('never invokes getters and rejects unsupported prototypes', () => {
    let reads = 0
    const withGetter = Object.defineProperty({ safe: 'visible' }, 'secret', {
      enumerable: true,
      get() {
        reads += 1
        return 'not-safe'
      },
    })
    class CustomValue {
      value = 'hidden'
    }

    const getterProjection = projectStructuredValue(withGetter)
    expect(reads).toBe(0)
    expect(getterProjection).toMatchObject({
      kind: 'unsupported',
      unsupported: true,
    })
    expect(getterProjection.copyText).not.toContain('not-safe')
    expect(projectStructuredValue(new CustomValue())).toMatchObject({
      kind: 'unsupported',
      unsupported: true,
    })
    expect(readOwnDataProperty(new CustomValue(), 'value')).toBeUndefined()
  })

  it('marks circular, deep, wide, and long values without recursive failure', () => {
    const circular: Record<string, unknown> = { name: 'root' }
    circular.self = circular

    let deep: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 20_000; index += 1) deep = { next: deep }

    const circularProjection = projectStructuredValue(circular)
    expect(circularProjection.unsupported).toBe(true)
    expect(circularProjection.copyText).toContain('<circular>')

    const deepProjection = projectStructuredValue(deep, { maxDepth: 4 })
    expect(deepProjection.truncated).toBe(true)
    expect(deepProjection.copyText).toContain('<depth limit>')
    expect(() => projectStructuredValue(deep, { maxDepth: 20_000 })).not.toThrow()

    const bounded = projectStructuredValue({
      values: Array.from({ length: 200 }, (_, index) => index),
      text: '中'.repeat(10_000),
    }, {
      maxContainerItems: 8,
      maxEntries: 12,
      maxStringBytes: 64,
      maxCopyBytes: 256,
    })
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.copyText, 'utf8')).toBeLessThanOrEqual(256)
  })

  it('bounds displayed keys and values without shortening an in-budget exact copy', () => {
    const key = '键'.repeat(600)
    const value = 'x'.repeat(3_000)
    const projection = projectStructuredValue({ [key]: value }, {
      maxStringBytes: 64,
      maxDisplayBytes: 160,
      maxCopyBytes: 8_000,
    })

    expect(projection.truncated).toBe(true)
    expect(JSON.parse(projection.copyText)).toEqual({ [key]: value })
    const root = projection.nodes[0]
    if (root?.kind !== 'object') throw new Error('Expected object projection')
    const child = root.children[0]
    if (child?.kind !== 'scalar') throw new Error('Expected scalar child')
    expect(Buffer.byteLength(child.label ?? '', 'utf8')).toBeLessThanOrEqual(64)
    expect(Buffer.byteLength(child.value, 'utf8')).toBeLessThanOrEqual(64)
  })

  it('degrades unsupported scalar types and oversized JSON-like text truthfully', () => {
    expect(projectStructuredValue(Symbol('hidden'))).toMatchObject({
      kind: 'unsupported',
      unsupported: true,
    })
    const oversized = projectStructuredValue(`{"value":"${'x'.repeat(2_000)}"}`, {
      maxJsonParseBytes: 100,
      maxCopyBytes: 120,
      maxStringBytes: 80,
    })
    expect(oversized).toMatchObject({
      kind: 'truncated',
      summary: '<JSON exceeds preview limit>',
      truncated: true,
    })
    expect(Buffer.byteLength(oversized.copyText, 'utf8')).toBeLessThanOrEqual(120)
  })
})
