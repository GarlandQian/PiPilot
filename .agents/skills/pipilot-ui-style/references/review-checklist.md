# PiPilot UI Review Checklist

Use this checklist for a design proposal, implementation review, or screenshot
pass. Mark an item not applicable only when the affected surface genuinely does
not exercise it.

## Product And Boundaries

- [ ] The requested surface and user workflow are named clearly.
- [ ] Data comes from the existing owning component/store/adapter or official
      Pi projection; no renderer filesystem or direct Pi access was added.
- [ ] Optional capability states are truthful (available, missing, loading,
      empty, error) and no demo/session data is presented as real.
- [ ] The change does not expose raw session graph IDs, hidden branches,
      protocol records, or secrets.

## Composition And Hierarchy

- [ ] The frame keeps the 48px rail, contextual panel, main surface, parallel
      inspector, and compact status bar roles legible where applicable.
- [ ] Sections are unframed layouts or full-width bands; cards are reserved for
      repeated items, dialogs, or genuinely framed tools.
- [ ] Neutral gray surfaces, hairline borders, and spacing carry hierarchy.
- [ ] Sage is the only decorative/active accent; no gradient, glass, neon,
      bokeh, or ornamental shadow was introduced.
- [ ] Type scale matches the container and does not scale with viewport width.

## Tokens And Components

- [ ] Colors, radii, motion, font families, and control/row heights use the
      existing CSS variables or an approved primitive variant.
- [ ] Existing `src/components/ui/` primitives are reused before creating a
      new interaction shell or dependency.
- [ ] Icons use the established Tabler/react-icons set, with tooltips for
      unfamiliar icon-only controls.
- [ ] Dynamic lists use stable domain IDs rather than array indexes.
- [ ] Fixed-format controls have stable dimensions so hover, focus, and text
      changes cannot shift neighboring content.

## Interaction And Accessibility

- [ ] Every action is pointer reachable and keyboard reachable.
- [ ] Native buttons, tabs, list semantics, labels, and visible focus rings are
      used; Enter/Space behavior is preserved.
- [ ] Arrow/Home/End order matches the visual order for ordered lists.
- [ ] Focus returns to or remains on the logical control after menus, dialogs,
      picker selection, and conversation jumps.
- [ ] Reduced motion disables smooth scrolling and animated emphasis where the
      surface uses them.
- [ ] Loading, empty, error, and unavailable states are announced or labeled
      through the existing panel semantics.

## Content, i18n, And Responsive Behavior

- [ ] All visible strings exist in both `en-US` and `zh-CN` catalogs with key
      parity.
- [ ] Labels, helper text, and status values wrap or truncate without overlap
      at the 1100 x 680 minimum and in Chinese.
- [ ] The 1440 x 900 light/dark hierarchy remains coherent, and high-density
      pickers/dialogs stay within the intended editor or viewport bounds.
- [ ] Session replacement or stale async work cannot leak previous content,
      anchors, highlights, or navigation requests.

## Verification

- [ ] The smallest relevant focused test/check was run and its real outcome is
      recorded.
- [ ] `pnpm typecheck` or `pnpm build` was run when shared renderer types or
      bundle composition changed.
- [ ] The relevant Electron flow or screenshot was inspected when desktop
      behavior or geometry changed.
- [ ] No unrelated product files, generated artifacts, or local skill symlinks
      were modified.
