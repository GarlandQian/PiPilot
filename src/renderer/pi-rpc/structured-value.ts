import type {
  StructuredValueNode,
  StructuredValueProjection,
} from '@/types/chat'

export interface StructuredValueLimits {
  maxDepth: number
  maxEntries: number
  maxContainerItems: number
  maxStringBytes: number
  maxDisplayBytes: number
  maxCopyBytes: number
  maxSummaryBytes: number
  maxJsonParseBytes: number
}

export const DEFAULT_STRUCTURED_VALUE_LIMITS: StructuredValueLimits = {
  maxDepth: 6,
  maxEntries: 96,
  maxContainerItems: 32,
  maxStringBytes: 2_048,
  maxDisplayBytes: 32_000,
  maxCopyBytes: 24_000,
  maxSummaryBytes: 160,
  maxJsonParseBytes: 64_000,
}

interface MutableStructuredValueNode {
  kind: StructuredValueNode['kind']
  label?: string
  copyLabel?: string
  value?: string
  summary?: string
  children?: MutableStructuredValueNode[]
  literal?: string
}

type ProjectionTask =
  | {
      kind: 'visit'
      value: unknown
      depth: number
      node: MutableStructuredValueNode
    }
  | {
      kind: 'leave'
      value: object
    }

interface ProjectionState {
  limits: StructuredValueLimits
  entries: number
  displayBytes: number
  truncated: boolean
  unsupported: boolean
}

const ABSOLUTE_STRUCTURED_VALUE_LIMITS: StructuredValueLimits = {
  maxDepth: 64,
  maxEntries: 1_024,
  maxContainerItems: 256,
  maxStringBytes: 64_000,
  maxDisplayBytes: 256_000,
  maxCopyBytes: 64_000,
  maxSummaryBytes: 1_024,
  maxJsonParseBytes: 1_048_576,
}

function resolveLimits(overrides: Partial<StructuredValueLimits>) {
  const requested = { ...DEFAULT_STRUCTURED_VALUE_LIMITS, ...overrides }
  const bounded = (key: keyof StructuredValueLimits) => {
    const fallback = DEFAULT_STRUCTURED_VALUE_LIMITS[key]
    const finite = Number.isFinite(requested[key]) ? Math.floor(requested[key]) : fallback
    return Math.max(0, Math.min(finite, ABSOLUTE_STRUCTURED_VALUE_LIMITS[key]))
  }
  return {
    maxDepth: bounded('maxDepth'),
    maxEntries: bounded('maxEntries'),
    maxContainerItems: bounded('maxContainerItems'),
    maxStringBytes: bounded('maxStringBytes'),
    maxDisplayBytes: bounded('maxDisplayBytes'),
    maxCopyBytes: bounded('maxCopyBytes'),
    maxSummaryBytes: bounded('maxSummaryBytes'),
    maxJsonParseBytes: bounded('maxJsonParseBytes'),
  }
}

function utf8Width(value: string, index: number) {
  const first = value.charCodeAt(index)
  if (first <= 0x7f) return { bytes: 1, units: 1 }
  if (first <= 0x7ff) return { bytes: 2, units: 1 }
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = value.charCodeAt(index + 1)
    if (second >= 0xdc00 && second <= 0xdfff) return { bytes: 4, units: 2 }
  }
  return { bytes: 3, units: 1 }
}

function byteLength(value: string, stopAfter = Number.POSITIVE_INFINITY) {
  let bytes = 0
  for (let index = 0; index < value.length;) {
    const width = utf8Width(value, index)
    bytes += width.bytes
    if (bytes > stopAfter) return bytes
    index += width.units
  }
  return bytes
}

export function truncateUtf8(value: string, maxBytes: number) {
  if (maxBytes <= 0) return { value: '', truncated: value.length > 0 }
  if (byteLength(value, maxBytes) <= maxBytes) return { value, truncated: false }

  const marker = '…'
  const markerBytes = byteLength(marker)
  if (markerBytes > maxBytes) return { value: '', truncated: true }
  const contentBudget = maxBytes - markerBytes
  let bytes = 0
  let end = 0
  while (end < value.length) {
    const width = utf8Width(value, end)
    if (bytes + width.bytes > contentBudget) break
    bytes += width.bytes
    end += width.units
  }
  return { value: `${value.slice(0, end)}${marker}`, truncated: true }
}

function compactFirstLine(value: string, maxBytes: number) {
  const scanLength = Math.min(value.length, Math.max(1_024, maxBytes * 8))
  const prefix = value.slice(0, scanLength)
  const carriageReturn = prefix.indexOf('\r')
  const lineFeed = prefix.indexOf('\n')
  const lineEnd = carriageReturn < 0
    ? lineFeed
    : lineFeed < 0
      ? carriageReturn
      : Math.min(carriageReturn, lineFeed)
  const firstLine = (lineEnd < 0 ? prefix : prefix.slice(0, lineEnd))
    .replace(/\s+/gu, ' ')
    .trim()
  const bounded = truncateUtf8(firstLine, maxBytes)
  return {
    value: bounded.value,
    truncated: bounded.truncated || (lineEnd < 0 && scanLength < value.length),
  }
}

function looksJsonLike(value: string) {
  const start = value.slice(0, 256).trimStart()
  if (/^[\[{"]/u.test(start)) return true
  if (value.length > 256) return false
  return /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/u.test(start.trimEnd())
}

function scalarLiteral(value: null | string | number | boolean) {
  return JSON.stringify(value)
}

function publicNode(node: MutableStructuredValueNode): StructuredValueNode {
  if (node.kind === 'scalar') {
    return {
      kind: 'scalar',
      ...(node.label === undefined ? {} : { label: node.label }),
      value: node.value ?? '',
    }
  }
  if (node.kind === 'object' || node.kind === 'array') {
    return {
      kind: node.kind,
      ...(node.label === undefined ? {} : { label: node.label }),
      summary: node.summary ?? '',
      children: (node.children ?? []).map(publicNode),
    }
  }
  return {
    kind: node.kind,
    ...(node.label === undefined ? {} : { label: node.label }),
    summary: node.summary ?? '',
  }
}

function unsupportedNode(node: MutableStructuredValueNode, reason: string, state: ProjectionState) {
  node.kind = 'unsupported'
  node.summary = `<${reason}>`
  node.literal = JSON.stringify(`<${reason}>`)
  delete node.value
  delete node.children
  state.unsupported = true
}

function truncatedNode(node: MutableStructuredValueNode, reason: string, state: ProjectionState) {
  node.kind = 'truncated'
  node.summary = `<${reason}>`
  node.literal = JSON.stringify(`<${reason}>`)
  delete node.value
  delete node.children
  state.truncated = true
}

function consumeDisplay(value: string, state: ProjectionState) {
  const remaining = Math.max(0, state.limits.maxDisplayBytes - state.displayBytes)
  const bounded = truncateUtf8(value, Math.min(remaining, state.limits.maxStringBytes))
  state.displayBytes += byteLength(bounded.value)
  state.truncated ||= bounded.truncated
  return bounded.value
}

function inspectOwnEntries(value: object, maxEntries: number):
  | { ok: true; kind: 'array' | 'object'; entries: readonly [string, unknown][]; count: number }
  | { ok: false; reason: string } {
  let prototype: object | null
  let keys: (string | symbol)[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return { ok: false, reason: 'uninspectable' }
  }

  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) return { ok: false, reason: 'array subclass' }
    let lengthDescriptor: PropertyDescriptor | undefined
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    } catch {
      return { ok: false, reason: 'uninspectable' }
    }
    const length = lengthDescriptor && 'value' in lengthDescriptor
      ? lengthDescriptor.value
      : null
    if (!Number.isSafeInteger(length) || length < 0) {
      return { ok: false, reason: 'invalid array length' }
    }
    const entries: [string, unknown][] = []
    for (let index = 0; index < Math.min(length, maxEntries); index += 1) {
      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      } catch {
        return { ok: false, reason: 'uninspectable' }
      }
      if (!descriptor) return { ok: false, reason: 'sparse array' }
      if (!('value' in descriptor) || !descriptor.enumerable) {
        return { ok: false, reason: 'accessor' }
      }
      entries.push([String(index), descriptor.value])
    }
    for (const key of keys) {
      if (typeof key === 'symbol') return { ok: false, reason: 'symbol key' }
      if (key === 'length') continue
      const numeric = Number(key)
      if (!Number.isInteger(numeric) || numeric < 0 || numeric >= length) {
        return { ok: false, reason: 'array property' }
      }
    }
    if (keys.length !== length + 1) return { ok: false, reason: 'sparse array' }
    return { ok: true, kind: 'array', entries, count: length }
  }

  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, reason: 'class instance' }
  }
  if (keys.some((key) => typeof key === 'symbol')) {
    return { ok: false, reason: 'symbol key' }
  }
  const entries: [string, unknown][] = []
  for (const key of keys.slice(0, maxEntries)) {
    if (typeof key !== 'string') return { ok: false, reason: 'symbol key' }
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return { ok: false, reason: 'uninspectable' }
    }
    if (!descriptor || !('value' in descriptor)) return { ok: false, reason: 'accessor' }
    if (descriptor.enumerable) entries.push([key, descriptor.value])
  }
  return {
    ok: true,
    kind: 'object',
    entries,
    count: keys.length,
  }
}

function renderNodeCopy(node: MutableStructuredValueNode, depth = 0): string {
  if (node.kind === 'scalar' || node.kind === 'truncated' || node.kind === 'unsupported') {
    return node.literal ?? JSON.stringify(node.value ?? node.summary ?? '')
  }
  const children = node.children ?? []
  if (children.length === 0) return node.kind === 'array' ? '[]' : '{}'
  const indent = '  '.repeat(depth + 1)
  const closeIndent = '  '.repeat(depth)
  if (node.kind === 'array') {
    return `[\n${children.map((child) => `${indent}${renderNodeCopy(child, depth + 1)}`).join(',\n')}\n${closeIndent}]`
  }
  return `{\n${children.map((child) => {
    const key = JSON.stringify(child.copyLabel ?? child.label ?? '')
    return `${indent}${key}: ${renderNodeCopy(child, depth + 1)}`
  }).join(',\n')}\n${closeIndent}}`
}

function projectValue(
  value: unknown,
  limits: StructuredValueLimits,
  sourceKind?: StructuredValueProjection['kind'],
  sourceCopy?: string,
): StructuredValueProjection {
  const state: ProjectionState = {
    limits,
    entries: 0,
    displayBytes: 0,
    truncated: false,
    unsupported: false,
  }
  const root: MutableStructuredValueNode = { kind: 'scalar', value: '' }
  const activeContainers = new Set<object>()
  const tasks: ProjectionTask[] = [{ kind: 'visit', value, depth: 0, node: root }]

  while (tasks.length > 0) {
    const task = tasks.pop()
    if (!task) break
    if (task.kind === 'leave') {
      activeContainers.delete(task.value)
      continue
    }

    const current = task.value
    if (current === null || typeof current === 'string' ||
      typeof current === 'boolean' || typeof current === 'number') {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        unsupportedNode(task.node, 'non-finite number', state)
        continue
      }
      const display = current === null ? 'null' : String(current)
      const boundedDisplay = consumeDisplay(display, state)
      task.node.kind = 'scalar'
      task.node.value = boundedDisplay
      if (typeof current === 'string') {
        const boundedCopy = truncateUtf8(current, limits.maxCopyBytes)
        state.truncated ||= boundedCopy.truncated
        task.node.literal = scalarLiteral(boundedCopy.value)
      } else {
        task.node.literal = scalarLiteral(current)
      }
      continue
    }

    if (typeof current !== 'object') {
      unsupportedNode(task.node, typeof current, state)
      continue
    }
    if (activeContainers.has(current)) {
      unsupportedNode(task.node, 'circular', state)
      continue
    }
    if (task.depth >= limits.maxDepth) {
      truncatedNode(task.node, 'depth limit', state)
      continue
    }

    const inspected = inspectOwnEntries(
      current,
      Math.min(limits.maxContainerItems, Math.max(0, limits.maxEntries - state.entries)),
    )
    if (!inspected.ok) {
      unsupportedNode(task.node, inspected.reason, state)
      continue
    }

    const visibleCount = Math.min(
      inspected.entries.length,
      limits.maxContainerItems,
      Math.max(0, limits.maxEntries - state.entries),
    )
    task.node.kind = inspected.kind
    task.node.summary = inspected.kind === 'array'
      ? `[${inspected.count}]${visibleCount < inspected.count ? ' …' : ''}`
      : `{${inspected.count}}${visibleCount < inspected.count ? ' …' : ''}`
    task.node.children = []

    activeContainers.add(current)
    tasks.push({ kind: 'leave', value: current })

    if (visibleCount < inspected.count) {
      const omitted = inspected.count - visibleCount
      const marker: MutableStructuredValueNode = {
        kind: 'truncated',
        ...(inspected.kind === 'array' ? { label: `+${omitted}` } : {}),
        summary: `<${omitted} omitted>`,
        literal: JSON.stringify(`<${omitted} omitted>`),
      }
      task.node.children.push(marker)
      state.truncated = true
    }

    const children: MutableStructuredValueNode[] = []
    for (let index = 0; index < visibleCount; index += 1) {
      const [key] = inspected.entries[index] ?? ['', undefined]
      const displayLabel = inspected.kind === 'array' ? `[${key}]` : key
      const boundedCopyLabel = truncateUtf8(key, limits.maxCopyBytes)
      state.truncated ||= boundedCopyLabel.truncated
      children.push({
        kind: 'scalar',
        label: consumeDisplay(displayLabel, state),
        ...(inspected.kind === 'object' ? { copyLabel: boundedCopyLabel.value } : {}),
        value: '',
      })
    }
    task.node.children.unshift(...children)
    state.entries += visibleCount
    for (let index = visibleCount - 1; index >= 0; index -= 1) {
      const entry = inspected.entries[index]
      const child = children[index]
      if (!entry || !child) continue
      tasks.push({
        kind: 'visit',
        value: entry[1],
        depth: task.depth + 1,
        node: child,
      })
    }
  }

  let valueKind: StructuredValueProjection['valueKind'] = 'scalar'
  if (root.kind === 'object') valueKind = 'object'
  else if (root.kind === 'array') valueKind = 'array'

  const generatedCopy = sourceCopy ?? renderNodeCopy(root)
  const boundedCopy = truncateUtf8(generatedCopy, limits.maxCopyBytes)
  state.truncated ||= boundedCopy.truncated
  const summary = root.kind === 'object' || root.kind === 'array'
    ? root.summary ?? (root.kind === 'array' ? '[]' : '{}')
    : root.kind === 'scalar'
      ? compactFirstLine(root.value ?? '', limits.maxSummaryBytes).value || '<empty>'
      : root.summary ?? '<unsupported>'

  return {
    kind: sourceKind ?? (root.kind === 'array'
      ? 'array'
      : root.kind === 'object'
        ? 'object'
        : root.kind === 'unsupported'
          ? 'unsupported'
          : 'scalar'),
    valueKind,
    summary: state.truncated && !summary.endsWith('…') ? `${summary} …` : summary,
    copyText: boundedCopy.value,
    nodes: [publicNode(root)],
    truncated: state.truncated,
    malformed: false,
    unsupported: state.unsupported,
  }
}

export function projectStructuredValue(
  value: unknown,
  overrides: Partial<StructuredValueLimits> = {},
): StructuredValueProjection {
  const limits = resolveLimits(overrides)
  if (value === undefined || value === '') {
    return {
      kind: 'empty',
      valueKind: 'scalar',
      summary: '<empty>',
      copyText: '',
      nodes: [{ kind: 'scalar', value: '' }],
      truncated: false,
      malformed: false,
      unsupported: false,
    }
  }

  if (typeof value === 'string') {
    const sourceBytes = byteLength(value, limits.maxJsonParseBytes)
    const boundedCopy = truncateUtf8(value, limits.maxCopyBytes)
    const jsonLike = looksJsonLike(value)
    if (jsonLike && sourceBytes > limits.maxJsonParseBytes) {
      const boundedDisplay = truncateUtf8(value, limits.maxStringBytes)
      return {
        kind: 'truncated',
        valueKind: 'scalar',
        summary: '<JSON exceeds preview limit>',
        copyText: boundedCopy.value,
        nodes: [{ kind: 'scalar', value: boundedDisplay.value }],
        truncated: true,
        malformed: false,
        unsupported: false,
      }
    }
    if (jsonLike) {
      try {
        const parsed = JSON.parse(value) as unknown
        const projection = projectValue(parsed, limits, 'json', boundedCopy.value)
        return {
          ...projection,
          truncated: projection.truncated || boundedCopy.truncated,
        }
      } catch {
        const boundedDisplay = truncateUtf8(value, limits.maxStringBytes)
        return {
          kind: 'malformed',
          valueKind: 'scalar',
          summary: '<invalid JSON>',
          copyText: boundedCopy.value,
          nodes: [{ kind: 'scalar', value: boundedDisplay.value }],
          truncated: boundedCopy.truncated || boundedDisplay.truncated,
          malformed: true,
          unsupported: false,
        }
      }
    }
    const display = truncateUtf8(value, limits.maxStringBytes)
    const summary = compactFirstLine(value, limits.maxSummaryBytes)
    return {
      kind: 'text',
      valueKind: 'scalar',
      summary: summary.value || '<empty>',
      copyText: boundedCopy.value,
      nodes: [{ kind: 'scalar', value: display.value }],
      truncated: boundedCopy.truncated || display.truncated || summary.truncated,
      malformed: false,
      unsupported: false,
    }
  }

  return projectValue(value, limits)
}

export function projectPlainText(
  value: string,
  overrides: Partial<StructuredValueLimits> = {},
): StructuredValueProjection {
  const limits = resolveLimits(overrides)
  if (!value) return projectStructuredValue('', limits)
  const display = truncateUtf8(value, limits.maxStringBytes)
  const copy = truncateUtf8(value, limits.maxCopyBytes)
  const summary = compactFirstLine(value, limits.maxSummaryBytes)
  return {
    kind: 'text',
    valueKind: 'scalar',
    summary: summary.value || '<empty>',
    copyText: copy.value,
    nodes: [{ kind: 'scalar', value: display.value }],
    truncated: display.truncated || copy.truncated || summary.truncated,
    malformed: false,
    unsupported: false,
  }
}

export function readOwnDataProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
  } catch {
    return undefined
  }
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return undefined
  }
  return descriptor && 'value' in descriptor && descriptor.enumerable
    ? descriptor.value
    : undefined
}

export function boundedFirstLine(value: unknown, maxBytes = 160): string | null {
  if (typeof value !== 'string') return null
  const line = compactFirstLine(value, maxBytes).value
  return line || null
}
