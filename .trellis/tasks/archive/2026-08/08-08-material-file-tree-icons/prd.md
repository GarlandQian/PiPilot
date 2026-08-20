# Unify Icon Sources And Use Material File Icons

## Goal

Make icon ownership predictable while giving the file tree accurate community
filename, extension, and folder icons.

## Confirmed Facts

- Every current general UI icon import uses `react-icons/tb`; there is no mixed
  Lucide, Heroicons, Font Awesome, or other command-icon surface.
- `src/components/inspector/FileTree.tsx:86` currently distinguishes only
  folders, TypeScript files, and generic text files.
- `build/icon.svg`, `build/icon.png`, and `src/components/PiLogo.tsx` already use
  the PiPilot `pi` mark, but they are separate assets that can drift.
- `material-icon-theme@5.37.0` was the latest registry release verified on
  2026-08-08; implementation rechecks latest before installing with pnpm.

## Requirements

- Keep Tabler as the only general-purpose command, navigation, status, and
  control icon family.
- Add one specialized file-theme dependency: `material-icon-theme`, installed
  at the latest verified release with pnpm.
- Resolve file icons using the package's maintained filename/extension mappings
  and folder icons using its folder-name/open-state mappings; retain accessible
  filenames and existing Git status indicators.
- Use a deterministic Vite/Electron-compatible asset pipeline based on public
  package APIs/assets. Do not copy a hand-maintained mapping from another app or
  import unexported package internals.
- Generated/selected project assets are regular files or build output; do not
  commit machine-local symlinks to dependency assets.
- Keep the PiPilot brand outside both icon libraries. Generate or verify package
  icons from the same canonical PiPilot mark used by the renderer.
- Preserve tree row geometry, chevrons, lazy loading, selection, truncation,
  refresh, and light/dark contrast.

## Acceptance Criteria

- [ ] General UI icons remain Tabler-only, file/folder decorations come only
      from Material Icon Theme, and brand surfaces use only the PiPilot mark.
- [ ] Common code/config/document/image filenames and named folders resolve to
      the Material theme's expected icons, with generic fallbacks for unknowns.
- [ ] Open and closed folders render the matching theme state without shifting
      the row layout.
- [ ] The packaged macOS/Windows/Linux configuration points to an icon generated
      or verified from the same PiPilot mark displayed in the sidebar.
- [ ] The renderer does not ship an unnecessarily broad second action-icon set,
      and the icon assets resolve in both development and packaged builds.
- [ ] Dependency/license attribution is preserved and no Material-theme asset
      symlink or unrelated `.agents/skills/` symlink noise is staged.
- [ ] Typecheck, build, focused file-tree rendering, and packaged icon inspection
      pass.

## Out Of Scope

- Replacing Tabler with another generic command-icon family.
- Using Material file icons for buttons, menus, status badges, or the brand.
- User-selectable icon themes in this delivery.

## Dependency

This task is independent of the local Pi RPC migration. It owns icon dependency
configuration, file-tree icon resolution/assets, the canonical brand asset
pipeline, and package-icon verification. It must not change file enumeration or
Agent behavior.
