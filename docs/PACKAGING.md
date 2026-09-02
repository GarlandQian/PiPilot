# PiPilot Packaging and Distribution

PiPilot `0.0.2` is distributed through public GitHub Releases. The release
workflow builds each platform on its native GitHub-hosted runner, runs the
packaged smoke test, validates the artifact inventory and checksums, and then
creates one public Release with the complete validated asset set. A failed
native job or assembly check prevents Release creation.

## Targets and commands

| Platform | Architectures | Targets | Local command |
| --- | --- | --- | --- |
| macOS | arm64, x64 | DMG, ZIP | `pnpm package:mac` |
| Windows | x64 | NSIS | `pnpm package:win` |
| Linux | x64 | AppImage, DEB | `pnpm package:linux` |
| current host | current | unpacked directory | `pnpm package:dir` |

All commands run the TypeScript check and production Electron/Vite build first.
Dependencies are installed with pnpm and the checked-in frozen lockfile.

Release-candidate commands for updater metadata are used only by the native
release workflow:

```sh
pnpm package:win:update
pnpm package:linux:update
```

They use `electron-builder.update.yml` with the public GitHub provider and
`--publish never`. The build creates metadata locally; the assembly job publishes
the validated files together in the final public Release.

## Product identity

- package/product: `pipilot` / `PiPilot`
- application ID: `com.pipilot.desktop`
- current release: `0.0.2`
- first release: `0.0.1`
- stable tag: `v0.0.2`
- executable: `PiPilot` on macOS/Windows and `pipilot` on Linux
- output directory: ignored `release/`

## Trust and update policy

| Package | Check | In-app download/install | User action |
| --- | --- | --- | --- |
| macOS DMG/ZIP | Public GitHub latest release API | No; ad-hoc and not Developer ID signed/notarized | Open Release and download manually |
| Windows NSIS | Public GitHub latest release API | No; native install remains disabled without proof | Open Release and download manually |
| Linux AppImage | Official updater feed | Supported only after native fixture proof | Download/install explicitly |
| Linux DEB | Public GitHub latest release API | No | Open Release and install manually |

No package downloads or installs automatically. The Main process checks after a
short startup delay and at a conservative interval. The renderer exposes
explicit Check, Download, and Restart actions only when the package policy
allows them. Active Pi runtimes, runtime-pool tasks, and terminals require a
second confirmation before an updater restart.

macOS uses the base ad-hoc identity (`-`) solely for local launchability. It is
not an Apple Developer ID signature and is not notarized. Users may need to
choose **Open** in Finder or approve the application in System Settings. The
Windows build is unsigned and may trigger SmartScreen or an unknown-publisher
warning. These are expected unsigned-distribution limitations, not claims of trust.

Because an ad-hoc code identity can change whenever the application is rebuilt,
PiPilot starts Chromium with its mock keychain on macOS. This prevents Chromium
browser-profile encryption from repeatedly displaying a blocking **PiPilot Safe
Storage** password prompt. PiPilot does not store application credentials in
Chromium cookies or its password store. A future Developer ID/notarization
change must remove this switch and revalidate browser-data and credential
storage against the stable signed identity.

## Public Release workflow

The workflow is [`.github/workflows/release.yml`](../.github/workflows/release.yml).

1. Push an annotated stable tag matching `package.json`, for example
   `v0.0.2`.
2. Preflight verifies stable SemVer, exact package/tag identity, and public
   repository visibility. For `v0.0.1`, it also requires the tag to point to the
   repository's single root commit.
3. A release-owned verification job runs typecheck, the complete unit suite,
   production build, integration tests, and Electron E2E.
4. Native macOS, Windows, and Linux jobs install from the frozen lockfile,
   package, create a platform manifest/SHA-256 file, and run packaged smoke.
   Linux DEB metadata uses the repository's public noreply maintainer address.
   Before the Linux unpacked-app smoke, CI verifies the Chromium sandbox file
   exists, then assigns `root:root` ownership and mode `4755`; it never uses
   `--no-sandbox`, and the published AppImage/DEB files remain unchanged.
   The Windows smoke uses a native `.cmd` Pi fixture and normalizes ASAR path
   separators before checking package contents.
5. The assembly job rejects duplicate filenames, then validates all manifests,
   versions, updater metadata package references/sizes/SHA-512, exact inventory,
   and the absence of `latest-mac.yml`. Candidate preparation removes any
   `latest-mac.yml` generated as an electron-builder side effect before the
   macOS manifest is written. Architecture checks canonicalize standard native
   filename aliases (`x64`/`x86_64`/`amd64`, `arm64`/`aarch64`) without changing
   the published filenames. Windows metadata must identify the NSIS EXE and its
   blockmap; Linux metadata must identify both AppImage and DEB, with the legacy
   fields pointing to the primary AppImage. Every metadata entry is checked
   against the manifest, file size, and SHA-512.
6. Before changing the existing Release, Actions removes every older workflow
   run. Any cleanup failure stops publication while the prior Release remains
   available.
7. Actions stages one draft Release with only the expected assets after all
   checks have passed and verifies its server-side asset inventory.
8. The workflow publishes the verified draft, then verifies that the Release is
   public, latest, not a prerelease, and still has exactly the validated local
   asset inventory.

`workflow_dispatch` defaults to a dry run and never mutates Releases. A failed
verification or native job blocks assembly. The initial public reset may
replace only the mutable `v0.0.1` Release, and only after every new native
candidate has passed assembly validation. Replacement is not atomic: the
existing Release stays available through candidate validation, then is deleted
before the verified replacement draft is staged and published. Later versions
are never resumed or overwritten and require a higher SemVer. After the
new candidate is validated, the workflow deletes every older GitHub Actions run
across all workflows and its temporary build artifacts. This cleanup completes
before the existing Release is changed, leaving only the current public-release
run for this initial-history reset.

## Package boundary

`electron-builder.yml` uses ASAR and an explicit application allowlist. The
archive contains compiled Main, preload, renderer, the management helper,
`package.json`, and required production dependencies only. It does not contain
source code, tests, docs, build output, sessions, credentials, MCP files, or
the project AI-development directories (`.agents`, `.claude`, `.codex`, `.pi`,
`.trellis`, `AGENTS.md`, `.mcp.json`). Packaged smoke inspects the ASAR and
native files and fails if those roots or test artifacts appear.

`node-pty` bindings and the embedded SDK's native/runtime workers are unpacked
where native loading requires real files. The Electron fuse hook enables only
the bounded Node-mode management helper and disables unrelated Node execution
controls. The helper is not the Pi runtime: PiPilot packages the exact pinned
Pi SDK production dependency and runs it in supervised Electron utility
processes. Users do not install a separate Pi executable.

## External Control packaged entry

Settings > Integrations exposes the inbound External Control configuration only
after the feature is explicitly enabled. Every package publishes exactly the
same portable client configuration:

```json
{
  "mcpServers": {
    "pipilot": {
      "command": "pipilot-mcp",
      "args": []
    }
  }
}
```

The user explicitly installs or repairs the stable launcher before copying the
configuration. A managed launcher may later be removed through a separate
confirmation without disabling External Control or changing any client-owned
configuration. macOS/Linux use a receipt-bound wrapper in a secure stable user
directory that is already in `PATH`; removal requires matching no-follow file
and receipt identities. PiPilot does not edit shell profiles or request
administrator privileges. Windows uses the bundled lowercase
`pipilot-mcp.exe`, a CUI-subsystem copy of the packaged Electron executable,
and adds its directory to the current user's PATH while preserving unrelated
entries. Registry reads and writes use bounded private UTF-16 `.reg` exports
and imports so non-ASCII text, whitespace, empty entries, and the original
`REG_SZ`/`REG_EXPAND_SZ` type survive exactly. Users must sign out and back in
after first registration so subsequently launched clients inherit the change.
Windows removal keeps the packaged EXE, removes only the one receipt-proven PATH
entry, verifies exact read-back, and restores the original value on failure.
Unowned, changed, or ambiguous launcher state fails closed without mutation.
Clients never receive an inner-ASAR argument, `ELECTRON_RUN_AS_NODE`, absolute
installation path, descriptor path, token, or environment override.

The descriptor is a current-user-only `0600` file. It points to a per-instance
`0600` Unix socket in a random `0700` directory on macOS/Linux or a random
current-user named pipe on Windows, and contains the capability token that is
never placed in copied settings. The descriptor locator remains stable across
re-enable/restart while endpoint, token, and instance ID rotate. Disable closes
authenticated clients, removes the endpoint and descriptor, and invalidates
the previous credential.

The private packaged entry recognizes `--pipilot-mcp-stdio` before GUI
bootstrap; the public `pipilot-mcp` command supplies or infers that internal
mode without client arguments.
The shared headless path imports no BrowserWindow, uses macOS activation policy
`prohibited`, passes the packaged app version to the MCP server, and exits
through Electron `app.exit(code)`. stdout is reserved for MCP JSON-RPC;
unavailable/startup errors are bounded stderr and exit code 1. The local bridge
is not TCP/HTTP and does not use Keychain or Electron `safeStorage` for its
capability.

## Packaged smoke test

```sh
pnpm package:dir
pnpm test:packaged
```

The test launches the packaged executable with an isolated temporary user-data
directory, checks production mode and version `0.0.2`, inspects ASAR/native
contents, verifies the preload bridge, and exercises the bundled official Pi SDK
workflow. It does not use the developer's real Pi configuration or sessions.
The current macOS arm64 worktree also runs the copied command against the live
GUI and verifies MCP initialize/server version, six-tool discovery, authenticated
client count, protocol-only stdout, permission bits, disable cleanup, and
credential/endpoint/instance rotation. It also exits the enabled GUI, proves
the command fails boundedly while stopped, relaunches the same app/user data,
and verifies automatic readiness plus stable config and fresh credentials.
This local packaged smoke passed 2/2; other native platforms remain CI/device
evidence.

## Local update checks

The update state is Main-owned and crosses a strict validated IPC contract.
Development and unpackaged builds never contact the public feed. Production
manual-release packages, including the unsigned Windows NSIS build, use the
bounded GitHub latest-release API. Linux AppImage uses `electron-updater` with
`autoDownload=false`, no automatic install on quit, stable channel only, and
downgrade protection.

## Future signing

The repository intentionally does not contain signing credentials. Adding Apple
Developer ID/notarization or Windows signing is a separate reviewed change. It
must not be enabled by ambient credential discovery, and it must update the
release notes, updater policy, native verification matrix, and macOS Chromium
keychain policy together. A signed build must remove `use-mock-keychain` only
after its stable identity has been exercised without recurring Keychain prompts.

## Operator checklist

- [ ] `pnpm typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm build`
- [ ] `pnpm package:dir` and `pnpm test:packaged`
- [ ] release-owned source/Electron verification passes
- [ ] native GitHub runner jobs pass for all three platforms
- [ ] manifests, hashes, versions, and updater metadata match
- [ ] no `latest-mac.yml` is present
- [ ] macOS/Windows trust warnings are in the public release notes
- [ ] Release is created only after all verification, native, smoke, and assembly gates pass
