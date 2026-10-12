/** A user's argument template for an added app, filled in. A missing line reads as line 1. */
export function expandOpenArguments(args: readonly string[], values: { path: string; dir: string; line?: number }) {
  return args.map((arg) => arg.replace(/\{(path|dir|line)\}/g, (_, name: string) =>
    name === 'line' ? String(values.line ?? 1) : name === 'dir' ? values.dir : values.path))
}
