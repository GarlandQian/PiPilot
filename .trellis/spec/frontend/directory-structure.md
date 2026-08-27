# Frontend Directory Structure

## Layout

```text
src/
  App.tsx                         # renderer composition and top-level view state
  main.tsx                        # provider and React root wiring
  components/
    chat/                         # conversation, Composer, extension UI, Markdown
    inspector/                    # files, read-only diff, terminal
    layout/                       # shell, sidebar, session list, resize handle
    settings/                     # settings navigation, sections, config form models/dialogs
    ui/                           # reusable Radix/shadcn-style primitives
  renderer/adapters/              # Electron settings/workspace/MCP/external-control adapters
  renderer/composer/              # image/path submission projection
  renderer/pi-rpc/                # pure official Pi projector and presentation
  store/                          # settings, workspace/catalog, Pi RPC/external-control providers
  i18n/                           # translator and locale JSON catalogs
  lib/                            # renderer utilities and document-level effects
  styles/                         # Tailwind imports, tokens, global styles
  types/                          # renderer-only view models
```

## Placement Rules

- Put a reusable low-level control in `src/components/ui/`; feature composition
  belongs in its domain folder. `src/components/ui/button.tsx` and
  `src/components/chat/Composer.tsx` show the distinction.
- Put renderer access to `window.pipilot` in `src/renderer/adapters/`, not in
  feature components. See `workspace-adapter.ts` and `settings-adapter.ts`.
- Put state shared by several component branches in `src/store/`. Pure state
  transitions can live beside the provider, as in `renderer/pi-rpc/projector.ts`
  and `workspace-state.ts`.
- Types used outside the renderer live under `src/shared/`; renderer-only view
  types remain in `src/types/`.

## Naming

- Component files and exported components use PascalCase.
- Stores, adapters, utilities, and reducers use kebab-case filenames.
- Providers end in `Provider`; consuming hooks start with `use`.
- Keep test names aligned with the source concern, for example
  `tests/unit/local-pi-rpc-renderer.test.ts`.

## Examples

- `src/components/settings/SettingsLayout.tsx` composes domain settings views.
- `src/store/pi-rpc.tsx` owns official Pi view state and actions.
- `src/store/workspace.tsx` owns navigation, projects, and session catalogs.
