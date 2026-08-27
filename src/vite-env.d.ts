/// <reference types="vite/client" />

import type { PiPilotApi } from './shared/pipilot-api'

declare global {
  interface Window {
    readonly pipilot?: PiPilotApi
  }
}

declare module '*.css' {
  const content: Record<string, string>
  export default content
}

export {}
