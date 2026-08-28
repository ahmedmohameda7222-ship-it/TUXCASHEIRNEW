# TUX Operations Worker System Color — Dialog Amendment

## Status and precedence

Approved by direct user instruction on 2026-08-28 after the original System Color spec and implementation plan were written.

This amendment is the highest-precedence authority **only for the System Color dialog surface and the rendered-QA steps that drive that surface**. It supersedes conflicting dialog/UI-driving prose in:

- `docs/superpowers/specs/2026-08-28-tux-worker-system-color-design.md`
- `docs/superpowers/plans/2026-08-28-tux-worker-system-color.md`

All non-conflicting architecture, persistence, synchronization, palette, accessibility, semantic-color, worker-isolation, migration, and pre-merge requirements in those documents remain binding.

## Exact approved dialog

The modal title remains:

```text
Choose system color
```

The dialog contains exactly two setting rows:

1. `System Color` + one native square `input[type=color]`.
2. `Default` + one checkbox.

The footer contains:

- `Cancel`
- `Save`

The dialog must not expose:

- a raw HEX text input;
- RGB numeric fields;
- EyeDropper / `Pick from screen`;
- a separate `Reset to TUX default` action.

`Default` is the only reset/default control and maps to the canonical persisted preference `accentColor: null`.

## Transaction behavior

- Opening the dialog initializes the draft from the active worker's saved `accentColor`.
- If the saved accent is `null`, `Default` is checked and the native picker displays the current TUX default base color for visual continuity.
- Selecting a native color normalizes it through the canonical accent parser, makes the draft custom, unchecks `Default`, and applies live preview.
- Checking `Default` sets the draft to `null` and previews the exact existing TUX palette by clearing runtime accent overrides.
- Unchecking `Default` uses the current native picker value as the custom draft.
- `Cancel`, Escape, and permitted backdrop dismissal restore the exact previously saved worker accent and persist nothing.
- `Save` persists only `accentColor` via the intent-specific accent mutation.
- While Save is in flight, color-mutating controls and modal actions are disabled as required by the implementation transaction.
- Save failure keeps the dialog open, preserves the draft preview, and shows an inline error.

## Appearance ownership

The existing device-local selector remains unchanged:

```text
System | Light | Dark
```

This amendment does not make Appearance worker-synced and does not alter its `localStorage` ownership.

## Accessibility and responsive requirements

- The modal remains labelled by `Choose system color`.
- `System Color` and `Default` are programmatic labels for their controls.
- The native picker is at least 44x44 CSS pixels.
- The checkbox has an effective 44x44 interaction target.
- Cancel and Save remain at least 44px high.
- Focus enters the dialog on open and remains trapped inside the modal.
- Escape cancels when not saving.
- Save errors use an alert/live region.
- The dialog remains inside the viewport with no horizontal clipping on configured desktop, tablet, and mobile projects.
- Forced-colors behavior remains supported.

## Rendered QA amendment

Feature-specific rendered QA lives in:

```text
e2e/worker-system-color.e2e.ts
```

The System Color rendered suite must verify:

- exact two-row dialog structure;
- one `input[type=color]`;
- one `input[type=checkbox]`;
- zero text color inputs;
- zero numeric RGB inputs;
- no EyeDropper action;
- no separate reset action;
- live preview and Cancel rollback;
- Save + reload persistence;
- `Default` live preview, Cancel rollback, Save, and reload persistence;
- menu-layout preservation across accent writes;
- worker A / worker B isolation;
- Light, Dark, and live System appearance behavior;
- action foreground contrast at or above 4.5:1 for representative rendered custom colors;
- exact desktop checks at 1366x768 and 1280x720;
- tablet/mobile containment and no horizontal overflow;
- evidence files including `system-color-light-blue-desktop.png`, `system-color-dark-blue-desktop.png`, `system-color-dialog-1280x720-light.png`, `system-color-picker-tablet.png`, and `system-color-picker-mobile.png`.

The exhaustive green/blue/purple/red/yellow/near-black/near-white palette robustness matrix remains covered by the palette unit tests. Rendered QA must not reintroduce forbidden HEX/RGB/EyeDropper controls merely to drive those colors.

## Explicitly unchanged requirements

This amendment does not change:

- worker-scoped `accentColor` ownership;
- `null` meaning exact TUX default;
- canonical persisted uppercase `#RRGGBB`;
- intent-specific `updateMenuLayout` and `updateAccentColor` writes;
- IndexedDB, SQLite, browser, Electron, server, or Supabase boundaries;
- repository-only/manual Supabase migration handling;
- runtime Light/Dark palette derivation and contrast thresholds;
- live `prefers-color-scheme` response under System appearance;
- stale-response guarding and wrong-worker-flash prevention;
- brand-accent token boundaries;
- semantic positive/warning/destructive color independence;
- the requirement to complete full CI, rendered QA, exact-diff review, and pre-merge review before merge.
