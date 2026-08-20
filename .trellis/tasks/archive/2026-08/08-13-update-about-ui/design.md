# Design

## Composition

Extend the current About composition with an un-nested `SettingSection` using
the existing row rhythm. It contains status/version metadata, an inline trust
notice when applicable, bounded progress, inline error, and the single primary
action valid for the current snapshot.

The update-available notice mounts in App's existing center work-surface notice
region and holds only version/dismiss/navigation presentation state. The
renderer update provider remains the truth source.

## State Mapping

- disabled: reason, no action except manual release when capability permits;
- idle/current: Check again;
- checking: centered/inline status and disabled duplicate check;
- available native: Download;
- available manual: Open GitHub Release;
- downloading: determinate bounded progress when total is known;
- downloaded: Restart and install;
- error: operation-specific inline error and valid retry action.

Install confirmation has a stronger second message when active Pi/terminal work
exists, using the Main typed confirmation-required result.

## Accessibility and Responsive

Native buttons and existing AlertDialog, visible focus, `role=status` for
checking/progress, `role=alert` for current errors, reduced-motion-safe icons,
localized labels, and no fixed English widths. Verify minimum window and both
themes against current approved PiPilot references.
