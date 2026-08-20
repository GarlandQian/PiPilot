# Design — recover macOS Session access after a Pi Host failure

## Decision

Keep the approved topology: one Utility Host per canonical project or
projectless scope, with multiple retained Session runtimes inside that Host.
Add two missing lifecycle contracts:

1. Utility reports its first fatal error before closing the MessagePort.
2. The next explicit Session activation retires a crashed scope entry and
   creates one fresh Host through a single-flight transition.

Recovery reopens the persisted Session. It never replays accepted work.

## First-fault protocol

The shared internal Host protocol gains a host-scoped terminal envelope:

```ts
type PiHostFailureEnvelope = {
  kind: 'host_failure'
  protocolVersion: 2
  hostEpoch: number
  error: PiHostError
}
```

The internal protocol version increments because both bundled endpoints ship
together and no compatibility bridge is required. The envelope has no Runtime
or request identity: a fatal Utility failure invalidates the whole Host epoch.

Utility behavior:

- classify fatal call sites with a stable uppercase code;
- normalize once into the bounded plain error DTO;
- omit stack data from the terminal envelope;
- best-effort post the envelope exactly once, then close and exit;
- never include prompts, Session contents, credentials, or arbitrary object
  graphs.

Controller behavior:

- accept `host_failure` only for the current Host epoch;
- atomically preserve it as the first authoritative failure;
- reject pending requests and publish one failed snapshot;
- ignore later close/exit callbacks for diagnostic replacement;
- retain existing fail-closed behavior for malformed envelopes.

Main persists only a safe diagnostic code through `MainDiagnostics`; it does
not write the error message, stack, cwd, Session path, or payload.

## Project Host recovery transaction

`ProjectHostPool` replaces the synchronous crashed-entry rejection with an
asynchronous scope acquisition boundary. A per-scope transition map makes the
operation single-flight.

```text
explicit Session open
  -> acquire scope Host
  -> existing ready/starting Host: join/use it
  -> existing crashed Host: join/create recovery transition
       -> detach stale listeners
       -> remove exact crashed entry by identity
       -> clear Runtime ownership and Session leases
       -> best-effort dispose old controller
       -> allocate and handshake one replacement Host
  -> create/bind/hydrate requested persisted Session Runtime
  -> ready, or one scoped terminal error
```

Identity checks are mandatory at every asynchronous boundary. A snapshot or
callback from the old controller cannot update the replacement entry.

The transition does not start in response to a background pool snapshot. This
prevents crash loops. A second failure while creating or using the replacement
returns a typed non-recoverable error for that activation. A later explicit
user action may attempt a new recovery.

## Runtime frontend and selection state

On a Host crash, `PiRuntimeFrontend` continues to:

- publish a terminal `crashed` snapshot for the active Runtime;
- discard every cached Runtime owned by that Host;
- preserve healthy Runtimes in other project Hosts;
- settle pending extension UI and commands for the failed generation.

Host start/recovery failures map to a specific non-recoverable frontend error
for the current activation. They are excluded from the existing generic
one-retry race recovery, so one click cannot create a restart loop.

On the next explicit Session open, Main confirms the new
`{scope, sessionId, generation}` before Renderer hydration. Renderer keeps the
row and conversation region in loading only until that exact target becomes
ready or error. Superseded requests cannot clear or overwrite a newer target.

## Isolation and data durability

- A Host crash ends all in-memory work in that project scope; this is already
  unavoidable once the Utility process exits.
- Persisted Session files and catalog rows are not deleted by crash recovery.
- Healthy project Hosts and their executing Sessions are not stopped.
- No prompt, tool call, mutation, queued command, or UI response is replayed.
- Projectless recovery uses the same scope-keyed mechanism.

## Verification strategy

### Unit and integration

- Utility sends one sanitized `host_failure` envelope before shutdown.
- Controller preserves that failure when port close and process exit follow.
- Pool crash -> next create retires old entry and uses a new controller.
- Two concurrent creates after a crash share one replacement Host.
- Stale old-controller snapshots cannot poison the replacement.
- Replacement failure settles once and does not loop.
- Runtime frontend clears crashed Host caches, retains another project's
  healthy cache, and recovers the requested persisted Session on the next open.
- Renderer selection reaches ready or error for crash, supersession, and
  recovery; no row remains loading indefinitely.

### Real Electron

Use isolated fixture directories and a test extension/tool that triggers one
Host shutdown exactly once via an external marker. Verify on macOS:

1. open Session A and Session B in the same populated project;
2. trigger the one-shot Host failure;
3. observe a terminal failed state rather than an endless spinner;
4. click Session B once and recover through a fresh Host;
5. return to Session A and render its persisted history;
6. keep a Session in a second project ready throughout;
7. repeat open/switch operations beyond the reported few-second window.

Run against the production build. Add packaged verification only if the
failure or recovery differs under packaged process/resource resolution.
