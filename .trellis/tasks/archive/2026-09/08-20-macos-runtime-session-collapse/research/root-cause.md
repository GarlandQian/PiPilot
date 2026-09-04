# Root-cause research — macOS runtime Session collapse

## User-observed failure

The failure occurs within seconds, not after extended memory or resource
pressure. After the first error, Session rows can no longer be opened. The
visible loading state is a downstream symptom: the authoritative failure begins
inside the embedded Pi Host lifecycle.

## Confirmed failure cascade

PiPilot uses one Utility Host per canonical project/projectless scope. A Host
owns multiple retained Session runtimes. This is the intended isolation model:
different projects do not share process-global plugin state, while Sessions in
one project can continue independently.

`ProjectHostPool.handleControllerSnapshot()` marks a failed Host and all of its
Runtimes as crashed. It releases their Session leases but leaves the crashed
Host entry in the `hosts` map. The next Session activation reaches
`getOrCreateHost()`, finds that entry, and immediately throws `HOST_CRASHED`.
No code retires the entry or allocates a replacement during a normal Session
open. This converts one Host failure into a permanent project-wide failure
until the application process is restarted.

`PiRuntimeFrontend` correctly publishes a crashed terminal snapshot and drops
cached Runtime ownership. However, its bounded generic activation retry calls
the same poisoned pool entry, so Renderer-only loading or retry changes cannot
recover the system.

## Confirmed first-fault evidence

Utility-side fatal paths call `postHostFailureAndShutdown()`. That method
normalizes the thrown value but discards the result, closes the MessagePort,
and exits. `PiHostController` can consequently report only a later
`PORT_CLOSED`, `HOST_EXITED`, or generic process error. The production
`MainDiagnostics` log contains only safe application bootstrap/ready codes and
is not connected to Host failures.

The installed `0.0.1` build later captured two deterministic failures. Its safe
Main log recorded `HOST_RUNTIME_FATAL` at `16:19:15.122Z` and `16:20:03.434Z`.
The active Pi Session persisted successful `write` tool results at
`16:19:15.121Z` and `16:20:03.434Z`, including the explicit-reopen retry.

Pi `0.84.2`'s official write implementation returns a result with
`details: undefined`. `projectPiHostDto()` omits undefined object fields by
design, but `localPiToolResultSchema` required a non-optional `details` field.
`projectRuntimeEvent()` therefore rejected the official `tool_execution_end`.
The Session event subscription caught that projection error and notified the
Host fatal listeners, closing the whole project Host and causing workspace
selection to clear. The same persisted workflow then failed again after the
user explicitly re-opened it.

## Isolated macOS probe

Two real Electron probes were run with:

- a completely temporary Pi agent directory and Electron user-data directory;
- a local fake model provider;
- the locally installed package directories, without reading or modifying real
  credentials, MCP configuration, Sessions, or package settings.

One probe observed startup for approximately 15 seconds; another submitted one
prompt and observed the Runtime for approximately 15 seconds afterward. Both
remained `ready`. This rules out the narrow hypothesis that the installed
package set always crashes merely by loading. It does not cover the reporter's
specific provider stream, extension event, tool execution, or packaged state.

## Considered approaches

### Renderer-only loading timeout

Rejected as the root fix. It can stop a spinner but leaves Main's crashed Host
entry permanently poisoned.

### Unconditional background restart loop

Rejected. It can repeatedly activate a deterministic faulty plugin/provider,
consume resources, obscure the first error, and accidentally suggest that
accepted work was replayed.

### One Host per Session

Rejected for this task. It changes the approved project-scoped plugin/process
isolation topology and substantially increases startup and memory cost.

### Explicit first-fault envelope plus demand-driven Host recovery

Recommended. Utility sends one bounded terminal Host-failure envelope before
closing. Main preserves that first diagnostic, retires the crashed scope entry,
and creates exactly one replacement Host only when the user explicitly opens a
Session again. Persisted Sessions are rehydrated; accepted work is never
replayed.

## Risks to cover

- Port close and process exit race the terminal failure envelope; Main must
  keep the first authoritative failure for a Host epoch.
- Concurrent Session opens must not allocate two replacement Hosts.
- Stale callbacks from the retired controller must not mutate the replacement.
- Runtime IDs, ownership maps, leases, pending requests, and extension UI must
  be cleared exactly once when the old Host is retired.
- A replacement Host that fails again during the same activation must produce
  one terminal error, not another automatic restart.
- Recovery must be scoped. A project Host failure must not stop or replace a
  healthy Host belonging to another project.
