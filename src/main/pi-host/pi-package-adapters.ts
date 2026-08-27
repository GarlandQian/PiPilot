/**
 * Prepare child-process execution for Pi extensions inside an Electron
 * utility process.
 *
 * `pi-subagents` launches Pi through `process.execPath`. In packaged Electron
 * that path is the app executable, not a standalone Node binary. Setting
 * ELECTRON_RUN_AS_NODE after the utility process is already alive makes its
 * extension-spawned children execute the resolved Pi CLI as Node without
 * rewriting the user's installed package.
 */
export function preparePiHostChildProcessEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  electronVersion: string | undefined = process.versions.electron,
): boolean {
  if (!electronVersion) return false
  environment.ELECTRON_RUN_AS_NODE = '1'
  return true
}
