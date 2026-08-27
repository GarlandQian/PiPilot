import {
  PI_HOST_MAX_DTO_DEPTH,
  PI_HOST_MAX_DTO_NODES,
  piHostDtoSchema,
  type PiHostDto,
} from '../../shared/pi-host-protocol'

export class PiHostDtoProjectionError extends Error {
  readonly code = 'HOST_DTO_UNCLONEABLE'

  constructor(message: string) {
    super(message)
    this.name = 'PiHostDtoProjectionError'
  }
}

type Destination = PiHostDto[] | Record<string, PiHostDto>

type WorkItem =
  | {
      kind: 'value'
      source: unknown
      destination: Destination
      key: string | number
      depth: number
    }
  | { kind: 'leave'; source: object }

function assign(
  destination: Destination,
  key: string | number,
  value: PiHostDto,
): void {
  if (Array.isArray(destination)) {
    destination[key as number] = value
    return
  }
  destination[key as string] = value
}

function projectionError(message: string): never {
  throw new PiHostDtoProjectionError(message)
}

/**
 * Copies validated SDK projections into the deliberately smaller Host DTO
 * subset. Undefined object fields are omitted like JSON; every other
 * unsupported value fails instead of being silently dropped.
 */
export function projectPiHostDto(value: unknown): PiHostDto {
  const holder: Record<string, PiHostDto> = { value: null }
  const work: WorkItem[] = [{
    kind: 'value',
    source: value,
    destination: holder,
    key: 'value',
    depth: 0,
  }]
  const activeContainers = new WeakSet<object>()
  let nodeCount = 0

  while (work.length > 0) {
    const item = work.pop()!
    if (item.kind === 'leave') {
      activeContainers.delete(item.source)
      continue
    }

    nodeCount += 1
    if (nodeCount > PI_HOST_MAX_DTO_NODES) {
      projectionError('Pi Host DTO projection exceeded the node limit.')
    }
    if (item.depth > PI_HOST_MAX_DTO_DEPTH) {
      projectionError('Pi Host DTO projection exceeded the depth limit.')
    }

    const current = item.source
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean'
    ) {
      assign(item.destination, item.key, current)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        projectionError('Pi Host DTO projection encountered an invalid number.')
      }
      assign(item.destination, item.key, current)
      continue
    }
    if (typeof current !== 'object') {
      projectionError(`Pi Host DTO projection cannot copy ${typeof current}.`)
    }
    if (activeContainers.has(current)) {
      projectionError('Pi Host DTO projection encountered a circular reference.')
    }

    let prototype: object | null
    let keys: (string | symbol)[]
    try {
      prototype = Object.getPrototypeOf(current)
      keys = Reflect.ownKeys(current)
    } catch {
      projectionError('Pi Host DTO projection could not inspect an object.')
    }

    activeContainers.add(current)
    work.push({ kind: 'leave', source: current })

    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) {
        projectionError('Pi Host DTO projection rejected an array subclass.')
      }
      if (
        keys.some((key) => typeof key === 'symbol') ||
        keys.length !== current.length + 1
      ) {
        projectionError('Pi Host DTO projection rejected a sparse array.')
      }
      const output: PiHostDto[] = new Array(current.length)
      assign(item.destination, item.key, output)
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index))
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
          projectionError('Pi Host DTO projection rejected an array accessor.')
        }
        if (descriptor.value === undefined) {
          projectionError('Pi Host DTO projection rejected an undefined array item.')
        }
        work.push({
          kind: 'value',
          source: descriptor.value,
          destination: output,
          key: index,
          depth: item.depth + 1,
        })
      }
      continue
    }

    if (prototype !== Object.prototype && prototype !== null) {
      projectionError('Pi Host DTO projection rejected a class instance.')
    }
    const output = Object.create(null) as Record<string, PiHostDto>
    assign(item.destination, item.key, output)
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]
      if (typeof key === 'symbol') {
        projectionError('Pi Host DTO projection rejected a symbol key.')
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        projectionError('Pi Host DTO projection rejected an accessor property.')
      }
      if (descriptor.value === undefined) continue
      work.push({
        kind: 'value',
        source: descriptor.value,
        destination: output,
        key,
        depth: item.depth + 1,
      })
    }
  }

  return piHostDtoSchema.parse(holder.value)
}
