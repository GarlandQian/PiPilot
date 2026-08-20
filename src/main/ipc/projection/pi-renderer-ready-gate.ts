export class LocalPiRendererReadyGate {
  private initialization: Promise<void> | null = null

  constructor(private readonly initialize: () => Promise<unknown>) {}

  signal() {
    if (!this.initialization) {
      this.initialization = Promise.resolve()
        .then(() => this.initialize())
        .then(() => undefined)
    }
    return this.initialization
  }
}
