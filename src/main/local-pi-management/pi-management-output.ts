interface PiOutputGuard {
  takeOverStdout(): void
  writeRawStdout(value: string): void
  flushRawStdout(): Promise<void>
}

/** Use the bundled SDK's own subprocess-aware JSON stdout guard. */
export async function createPiManagementOutput(): Promise<PiOutputGuard> {
  const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
  // The pinned SDK does not export this guard at its public package root.
  // Resolve it adjacent to that exact SDK, not a discovered CLI installation.
  const guard = await import(/* @vite-ignore */ new URL('./core/output-guard.js', entry).href) as PiOutputGuard
  guard.takeOverStdout()
  return guard
}
