import { z } from 'zod'

export const APPLICATION_UPDATE_RELEASE_URL =
  'https://github.com/GarlandQian/PiPilot/releases/latest' as const
export const APPLICATION_UPDATE_LATEST_API_URL =
  'https://api.github.com/repos/GarlandQian/PiPilot/releases/latest' as const

export const APPLICATION_UPDATE_SUMMARY_LIMIT = 8_192
export const APPLICATION_UPDATE_VERSION_LIMIT = 64
export const APPLICATION_UPDATE_URL_LIMIT = 2_048
export const APPLICATION_UPDATE_BYTES_LIMIT = Number.MAX_SAFE_INTEGER

export const applicationUpdateCapabilitySchema = z.enum([
  'native-install',
  'manual-release',
])
export type ApplicationUpdateCapability = z.infer<
  typeof applicationUpdateCapabilitySchema
>

export const applicationUpdatePlatformSchema = z.enum([
  'macos',
  'windows',
  'linux',
  'unsupported',
])
export type ApplicationUpdatePlatform = z.infer<
  typeof applicationUpdatePlatformSchema
>

export const applicationUpdatePackageSchema = z.enum([
  'development',
  'macos',
  'nsis',
  'appimage',
  'deb',
  'unsupported',
])
export type ApplicationUpdatePackage = z.infer<
  typeof applicationUpdatePackageSchema
>

export const applicationUpdateDisabledReasonSchema = z.enum([
  'development',
  'unpackaged',
  'unsupported-platform',
  'unsupported-package',
  'missing-feed',
])
export type ApplicationUpdateDisabledReason = z.infer<
  typeof applicationUpdateDisabledReasonSchema
>

export const applicationUpdateOperationSchema = z.enum([
  'check',
  'download',
  'install',
])
export type ApplicationUpdateOperation = z.infer<
  typeof applicationUpdateOperationSchema
>

export const applicationUpdateErrorCodeSchema = z.enum([
  'UPDATE_BUSY',
  'UPDATE_CHECK_FAILED',
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_INSTALL_FAILED',
  'UPDATE_INVALID_FEED',
  'UPDATE_INVALID_RELEASE',
  'UPDATE_NETWORK_UNAVAILABLE',
  'UPDATE_NOT_AVAILABLE',
  'UPDATE_NOT_DOWNLOADED',
  'UPDATE_UNSUPPORTED',
  'UPDATE_ACTIVE_WORK_CONFIRMATION_REQUIRED',
  'UPDATE_SHUTDOWN_FAILED',
])
export type ApplicationUpdateErrorCode = z.infer<
  typeof applicationUpdateErrorCodeSchema
>

const versionSchema = z
  .string()
  .trim()
  .min(1)
  .max(APPLICATION_UPDATE_VERSION_LIMIT)
  .regex(/^\d+\.\d+\.\d+$/u)

const releaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(APPLICATION_UPDATE_URL_LIMIT)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname === 'github.com' &&
      url.port === '' &&
      url.pathname.startsWith('/GarlandQian/PiPilot/releases/')
    )
  }, 'The release URL must belong to the public PiPilot GitHub Releases page.')

const checkedAtSchema = z.number().int().nonnegative().nullable()
const revisionSchema = z.number().int().nonnegative()

export const applicationUpdatePolicySchema = z
  .object({
    platform: applicationUpdatePlatformSchema,
    package: applicationUpdatePackageSchema,
    capability: applicationUpdateCapabilitySchema.nullable(),
    currentVersion: versionSchema,
    releaseUrl: releaseUrlSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    const expectedPlatform = (() => {
      if (policy.package === 'macos') return 'macos' as const
      if (policy.package === 'nsis') return 'windows' as const
      if (policy.package === 'appimage' || policy.package === 'deb') {
        return 'linux' as const
      }
      if (policy.package === 'unsupported') return 'unsupported' as const
      return null
    })()
    if (expectedPlatform !== null && policy.platform !== expectedPlatform) {
      context.addIssue({
        code: 'custom',
        message: 'The update package does not match the platform policy.',
        path: ['package'],
      })
    }
    const capabilityAllowed = (() => {
      if (policy.package === 'nsis') {
        // Unsigned Windows packages remain manual-release until the native
        // updater canary is proven. The package identity stays NSIS so the UI
        // can present the correct SmartScreen/unknown-publisher warning.
        return policy.capability === 'manual-release' || policy.capability === 'native-install'
      }
      if (policy.package === 'appimage') return policy.capability === 'native-install'
      if (policy.package === 'macos' || policy.package === 'deb') {
        return policy.capability === 'manual-release'
      }
      return policy.capability === null
    })()
    if (!capabilityAllowed) {
      context.addIssue({
        code: 'custom',
        message: 'The update capability does not match the package policy.',
        path: ['capability'],
      })
    }
  })
export type ApplicationUpdatePolicy = z.infer<
  typeof applicationUpdatePolicySchema
>

const snapshotBase = {
  revision: revisionSchema,
  policy: applicationUpdatePolicySchema,
  checkedAt: checkedAtSchema,
}

const releaseFields = {
  availableVersion: versionSchema,
  releaseUrl: releaseUrlSchema,
  releaseSummary: z
    .string()
    .max(APPLICATION_UPDATE_SUMMARY_LIMIT)
    .nullable(),
  releaseDate: z.iso.datetime().nullable(),
}

export const applicationUpdateSnapshotSchema = z
  .discriminatedUnion('state', [
  z
    .object({
      ...snapshotBase,
      state: z.literal('disabled'),
      reason: applicationUpdateDisabledReasonSchema,
    })
    .strict(),
  z.object({ ...snapshotBase, state: z.literal('idle') }).strict(),
  z.object({ ...snapshotBase, state: z.literal('checking') }).strict(),
  z.object({ ...snapshotBase, state: z.literal('current') }).strict(),
  z
    .object({
      ...snapshotBase,
      ...releaseFields,
      state: z.literal('available'),
      capability: applicationUpdateCapabilitySchema,
    })
    .strict(),
  z
    .object({
      ...snapshotBase,
      ...releaseFields,
      state: z.literal('downloading'),
      capability: z.literal('native-install'),
      progress: z
        .object({
          percent: z.number().finite().min(0).max(100),
          transferred: z
            .number()
            .finite()
            .nonnegative()
            .max(APPLICATION_UPDATE_BYTES_LIMIT),
          total: z
            .number()
            .finite()
            .nonnegative()
            .max(APPLICATION_UPDATE_BYTES_LIMIT),
          bytesPerSecond: z
            .number()
            .finite()
            .nonnegative()
            .max(APPLICATION_UPDATE_BYTES_LIMIT),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...snapshotBase,
      ...releaseFields,
      state: z.literal('downloaded'),
      capability: z.literal('native-install'),
    })
    .strict(),
  z
    .object({
      ...snapshotBase,
      state: z.literal('error'),
      operation: applicationUpdateOperationSchema,
      code: applicationUpdateErrorCodeSchema,
      capability: applicationUpdateCapabilitySchema.nullable(),
      recoverable: z.boolean(),
      retryState: z.enum(['idle', 'available', 'downloaded']),
      availableVersion: versionSchema.nullable(),
      releaseUrl: releaseUrlSchema,
    })
    .strict(),
  ])
  .superRefine((snapshot, context) => {
    if (
      (snapshot.state === 'available' ||
        snapshot.state === 'downloading' ||
        snapshot.state === 'downloaded') &&
      snapshot.capability !== snapshot.policy.capability
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The snapshot capability does not match its package policy.',
        path: ['capability'],
      })
    }
    if (
      (snapshot.state === 'downloading' || snapshot.state === 'downloaded') &&
      snapshot.policy.capability !== 'native-install'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only native-install packages can download or install updates.',
        path: ['policy', 'capability'],
      })
    }
    if (
      snapshot.state === 'error' &&
      snapshot.capability !== snapshot.policy.capability
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The error capability does not match its package policy.',
        path: ['capability'],
      })
    }
  })
export type ApplicationUpdateSnapshot = z.infer<
  typeof applicationUpdateSnapshotSchema
>

export const applicationUpdateChangedEventSchema = z
  .object({
    eventId: z.uuid(),
    snapshot: applicationUpdateSnapshotSchema,
  })
  .strict()
export type ApplicationUpdateChangedEvent = z.infer<
  typeof applicationUpdateChangedEventSchema
>

export const applicationUpdateActionResultSchema = z.discriminatedUnion(
  'outcome',
  [
    z
      .object({
        outcome: z.literal('accepted'),
        snapshot: applicationUpdateSnapshotSchema,
      })
      .strict(),
    z
      .object({
        outcome: z.literal('busy'),
        operation: applicationUpdateOperationSchema,
        snapshot: applicationUpdateSnapshotSchema,
      })
      .strict(),
    z
      .object({
        outcome: z.literal('confirmation-required'),
        activeWork: z
          .object({
            primaryPi: z.boolean(),
            runtimePool: z.boolean(),
            terminals: z.boolean(),
          })
          .strict(),
        snapshot: applicationUpdateSnapshotSchema,
      })
      .strict(),
  ],
)
export type ApplicationUpdateActionResult = z.infer<
  typeof applicationUpdateActionResultSchema
>

export function cloneApplicationUpdateSnapshot(
  snapshot: ApplicationUpdateSnapshot,
) {
  return structuredClone(applicationUpdateSnapshotSchema.parse(snapshot))
}

export function parseStableVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) return null
  const parts = match.slice(1).map((part) => Number(part))
  if (parts.some((part) => !Number.isSafeInteger(part) || part < 0)) return null
  return parts as [number, number, number]
}

export function compareStableVersions(left: string, right: string) {
  const leftParts = parseStableVersion(left)
  const rightParts = parseStableVersion(right)
  if (!leftParts || !rightParts) return null
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1
    if (leftParts[index] < rightParts[index]) return -1
  }
  return 0
}
