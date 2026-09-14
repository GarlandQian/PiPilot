import { execFile } from 'node:child_process'

export const LAUNCHER_COMMAND_TIMEOUT_MS = 5_000

/** Run only an already validated platform executable, without a shell or blocking Main. */
export function runLauncherCommand(
  executable: string,
  args: readonly string[],
  options: { maxBuffer?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], {
      encoding: 'buffer',
      maxBuffer: options.maxBuffer ?? 64 * 1024,
      timeout: options.timeoutMs ?? LAUNCHER_COMMAND_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      shell: false,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}
