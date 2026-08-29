# TUX Operations Worker System Color — Approved Dialog Amendment

**Status:** Approved follow-up authority

This amendment records the later approved refinement to the System Color dialog and its rendered QA. It supersedes only conflicting picker-surface instructions in the earlier worker System Color design/implementation documents. All other architecture, persistence, security, lifecycle, accessibility, palette, semantic-color, and verification requirements remain unchanged.

## Final approved System Color dialog

The dialog is intentionally minimal and contains exactly two setting rows:

1. **System Color** — one native square `<input type="color">`.
2. **Default** — one checkbox.

The transaction actions are:

- **Save** — persist the draft accent for the active worker only.
- **Cancel** — discard the draft and restore the previously saved preview.

The final approved dialog must **not** expose:

- a raw HEX text field;
- RGB numeric fields;
- EyeDropper / “Pick from screen” controls;
- a separate “Reset to TUX default” button.

The **Default** checkbox is the reset control. Checked means the persisted worker accent is `null`, which renders the exact canonical TUX default tokens. Unchecking restores the current native-picker draft without persisting until Save.

The native color picker remains the only custom-color input surface. Its live `input` events may update the preview, while Save remains the only persistence boundary.

## Appearance remains separate

`System | Light | Dark` remains unchanged and device-local. System Color personalization does not persist appearance mode and does not change the established appearance controls.

## Accessibility and transaction behavior

The existing approved accessibility requirements still apply:

- focus enters the dialog on open;
- Tab/Shift+Tab stay trapped inside the modal;
- Escape behaves like Cancel when not saving;
- focus returns to the stable operator trigger after the modal closes;
- controls remain at least 44px touch targets;
- Save/Cancel and inputs are disabled while saving;
- save failure remains inline and leaves the draft available for retry;
- forced-colors behavior remains supported.

## Rendered QA amendment

Rendered QA for the System Color dialog must verify the approved two-row surface instead of older richer-picker controls.

Required assertions include:

- exactly two `.system-color-row` rows;
- one `input[type="color"]`;
- one `input[type="checkbox"]`;
- zero text color inputs;
- zero RGB numeric inputs;
- no EyeDropper control;
- no standalone reset button;
- Save and Cancel remain visible and usable;
- no horizontal overflow;
- modal bounds remain inside each tested viewport;
- canonical opaque surface/border/shadow/text tokens are used so the modal never becomes transparent;
- worker-specific preview/save/cancel/default behavior remains isolated and persistent;
- Light, Dark, and System appearance behavior remains correct;
- action foreground contrast remains at least 4.5:1;
- desktop, tablet, and mobile rendered evidence remains visually clean.

## Precedence

When older worker-System-Color documents conflict with this dialog amendment, this amendment is the authority **only for the dialog surface and its directly corresponding rendered-QA expectations**. It does not weaken or replace any other approved requirement.
