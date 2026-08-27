# Visual Baseline

The images in `assets/reference-ui/` are the confirmed PiPilot UI reference set
captured from the current worktree on 2026-08-12. They are comparison evidence
for composition, spacing, hierarchy, density, and state treatment. Visible
fixture labels are synthetic capture content; do not copy them, session names,
paths, timestamps, or model labels into production UI.

## Asset Catalog

| Asset | Viewport | Theme | Surface / state |
| --- | --- | --- | --- |
| `app-shell-desktop-light.png` | 1440 x 900 | light | hydrated session, full frame |
| `app-shell-desktop-dark.png` | 1440 x 900 | dark | hydrated session, full frame |
| `app-shell-minimum-dark.png` | 1100 x 680 | dark | minimum supported frame |
| `app-shell-empty-light.png` | 1440 x 900 | light | no selected session |
| `app-shell-empty-dark.png` | 1440 x 900 | dark | no selected session |
| `session-loading.png` | 1440 x 900 | light | selected session loading |
| `composer-slash-picker.png` | current Electron capture | light | slash Commands + Skills, full Composer width |
| `composer-mention-picker.png` | current Electron capture | light | @ Files + Skills, same shared surface |
| `inspector-files.png` | 1440 x 900 | light | Files inspector tab |
| `inspector-changes.png` | 1440 x 900 | light | continuous Changes inspector |
| `inspector-outline.png` | 1440 x 900 | light | Conversation outline tab |
| `inspector-terminal.png` | 1440 x 900 | light | Terminal inspector tab |
| `integrations-overview.png` | 1100 x 680 | dark | Integrations overview |
| `integrations-packages.png` | 1100 x 680 | dark | Integrations packages |
| `integrations-resources.png` | 1100 x 680 | dark | Integrations resources |
| `integrations-mcp-structured.png` | 1100 x 680 | dark | MCP structured form |
| `integrations-mcp-raw.png` | 1100 x 680 | dark | MCP JSONC editor |

## Evidence Rules

- Compare composition, density, hierarchy, and state treatment; do not use the
  images as a pixel-level freeze.
- Picker captures are high-density exports. Judge CSS composition and relative
  width, not bitmap device-pixel dimensions.
- Fixture content is synthetic and is not a product requirement.
- If a requested state is not represented here, inspect the current Electron
  surface and record a new capture only after user review.

## Review Procedure

1. Select the matching asset and render at its viewport/theme (or the closest
   supported CSS viewport for high-density exports).
2. Check frame landmarks first: rail, panel boundaries, main header,
   Composer/status bar, and inspector width.
3. Check typography, row density, active indicators, focus treatment, and
   truncation/wrapping in both locales.
4. Exercise the changed state and its keyboard path. Verify reduced motion if
   scrolling, menus, highlights, or transitions are involved.
5. Treat intentional product changes as a reason to update the evidence after
   review, never as a reason to weaken accessibility or truthfulness.
