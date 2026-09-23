/** Refresh only a visible resource, serializing invalidations with slow requests. */
export class ResourceRefreshLoop {
  private active = false
  private disposed = false
  private running = false
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly refresh: () => Promise<unknown>, private readonly interval = 5_000) {}

  setActive(active: boolean) {
    if (this.disposed || this.active === active) return
    this.active = active
    this.clearTimer()
    if (active) this.invalidate()
  }

  invalidate() {
    if (this.disposed) return
    this.dirty = true
    this.clearTimer()
    if (this.active && !this.running) void this.run()
  }

  dispose() {
    this.disposed = true
    this.active = false
    this.clearTimer()
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async run() {
    if (!this.active || this.disposed || this.running) return
    this.running = true
    this.dirty = false
    try {
      await this.refresh()
    } catch {
      // Each resource owns its visible error state; future invalidations retry it.
    } finally {
      this.running = false
      if (this.active && !this.disposed) {
        if (this.dirty) void this.run()
        else this.timer = setTimeout(() => this.invalidate(), this.interval)
      }
    }
  }
}
