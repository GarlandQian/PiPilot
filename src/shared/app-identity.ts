/** A discovered application can have several launch paths and saved IDs. */
export function matchesAppId(entry: { id: string; aliases?: readonly string[] }, id: string | null | undefined): boolean {
  return id != null && (entry.id === id || entry.aliases?.includes(id) === true)
}
