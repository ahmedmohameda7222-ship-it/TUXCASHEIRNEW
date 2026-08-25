# TUX Operations Design System

This document is the enduring UI/UX authority for TUX Operations. Feature-specific specs may add detail, but they must not contradict these rules without an explicit design review.

## Product character

TUX Operations is a high-density restaurant POS for cashiers. The interface must optimize recognition, speed, state clarity, error prevention, and one-screen task completion. The visual character is premium and restrained rather than decorative.

Design calibration:
- Design variance: 4/10
- Motion intensity: 3/10
- Visual density: 7/10

The primary physical context is a cashier repeatedly scanning products, changing quantities, reviewing the current order, taking payment, and placing the order on a 14–16 inch laptop/desktop display under time pressure.

## Design principles

1. Function outranks decoration. Premium quality comes from spacing, typography, materials, state clarity, and consistency.
2. Preserve the one-screen POS workflow. Avoid unnecessary page transitions, modals, and memory bridges.
3. Use one action accent. The premium TUX green indicates primary action, current selection, focus, and direct manipulation—not decoration.
4. Keep status semantics separate from action semantics. Success, warning, and error use dedicated semantic tokens.
5. Avoid card nesting. A surface or card must earn its boundary through structure or interaction.
6. Use glass only where a distinct navigational/transient layer earns it. Content surfaces remain opaque.
7. Do not copy Apple literally. Use Apple-derived moves—restrained materials, hierarchy, spacing, state clarity, direct manipulation, and system typography—while preserving TUX identity.
8. Preserve existing business behavior, domain logic, routes, state contracts, accessibility names, and tested workflows during visual refactors unless a separate product decision explicitly changes them.

## Brand

The exact user-provided `favicon.svg` is the canonical TUX logo. Do not replace it with generated artwork, a typed `TUX` wordmark, recolored approximations, or altered proportions.

The canonical mark is used wherever the application needs a TUX brand mark, including the main app shell and sign-in/bootstrap surfaces. Browser favicon usage should point to the same canonical asset.

## Color architecture

Colors are expressed through semantic tokens. Components must not scatter raw hex values.

### Light theme

- Canvas: `#F8FAF9`
- Surface primary: `#FFFFFF`
- Surface secondary: `#F3F6F4`
- Text primary: `#181A19`
- Text secondary: `#707773`
- Hairline border: `#E3E9E6`
- Action green: `#1F6B52`
- Action green hover: `#195F48`
- Action green pressed: `#14533F`
- Action green soft: `#EAF4EF`
- Action green hover-soft: `#F3F8F5`
- Success: `#2B7A55`
- Warning: `#A86400`
- Error/destructive: `#B42318`

The canvas is intentionally near-white rather than pure white. Raised product/order surfaces use true white, creating depth without heavy shadow.

### Dark theme

Dark mode must remain a coherent supported theme rather than a broken inversion.

- Canvas: `#0E1110`
- Surface primary: `#141816`
- Surface secondary: `#1A201D`
- Text primary: `#F4F7F5`
- Text secondary: `#AAB4AF`
- Hairline border: `#29322E`
- Action green: `#5FAE8A`
- Action green hover: `#6DBA98`
- Action green pressed: `#4F9B7A`
- Action green soft: `#173429`
- Success: `#63B78E`
- Warning: `#E3A23A`
- Error/destructive: `#F06B61`
- Primary action foreground: `#07110C`

### Color usage

- Most of the interface is neutral canvas/surface/text/border.
- Premium green occupies a small visual share and is concentrated on primary action and current selection.
- Do not use a fully green product card to indicate quantity.
- Do not rely on color alone for state. Pair semantic color with text, iconography, quantity, border, or other explicit state cues.
- Do not reuse the action-green token as the success-status token.

## Typography

Use Apple HIG-derived system typography without bundling or imitating proprietary Apple font files.

Font stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
```

Approved hierarchy after Apple Docs review:

- Major screen title: 22px / 26px, Semibold
- Final monetary amount: 22px / 26px, Bold
- Current Order title: 17px / 22px, Semibold
- Primary action text: 16px / 20px, Semibold
- Product/cart item name: 15px / 20px, Semibold
- Top navigation/category label: 15px / 20px, Medium; active/selected Semibold
- Standard control and price: 14px / 18px, Medium
- Body/product description/input/payment value: 14px / 18px, Regular
- Subsection heading: 14px / 18px, Semibold
- Operational metadata/form label: 13px / 16px, Regular or Medium
- Tertiary hint only: 12px / 15–16px, Regular
- Final Total label: 18px / 22px, Semibold

Use Regular for content, descriptions, input/payment values, and supporting metadata. Use Medium for controls, prices, and field labels. Use Semibold for product/cart names, selected navigation, section anchors, and primary actions. Reserve Bold for exceptional emphasis, primarily the final monetary total.

Supporting metadata such as item counts is Regular by default; use Medium only when the value is operationally important.

All monetary and quantity values use tabular numerals:

```css
font-variant-numeric: tabular-nums;
```

Do not switch entire monetary labels to a monospace font. Avoid Thin/Light weights and tiny low-contrast copy.

## Geometry and materials

- Main floating navigation may use a restrained translucent material with backdrop blur, a hairline border, and a soft low-elevation shadow.
- A reduced-transparency fallback must render the main navigation as an opaque surface.
- Category/search navigation is a separate floating surface but primarily opaque, not a second glass layer.
- Product cards use 12–16px corner radii, a hairline border, and little or no shadow.
- Order rail is a structural secondary surface, not a giant decorative card.
- Avoid exaggerated 24–32px radii on ordinary content surfaces.
- Avoid simultaneous strong border + strong shadow + tinted background on the same component.

## Interaction targets and controls

- High-frequency touch/click targets are at least 44×44px, including categories, search/edit icon buttons, product steppers, and repeated payment controls.
- Place Order uses at least a 48px visible height.
- Segmented controls are appropriate for 2–4 related mutually exclusive options such as order type.
- Product steppers use direct `− quantity +` manipulation.
- Secondary controls such as notes and discount use progressive disclosure when they are not needed continuously.
- Destructive actions remain visually distinct and must not be confused with the premium-green primary action.
- Keyboard shortcuts and focus behavior already supported by the app must remain intact.

## Motion

Motion confirms state; it does not perform.

- Press feedback: about 100–150ms
- Most hover/selection transitions: about 150–250ms
- No bouncing, looping, floating, or decorative perpetual motion
- Respect `prefers-reduced-motion`
- Avoid layout-moving hover effects

## Accessibility

- Meet WCAG AA contrast for functional text and controls.
- Keep keyboard access and visible focus states.
- Preserve semantic roles and accessible labels where existing E2E/tests depend on them.
- Do not use color as the sole status indicator.
- Keep text legible at dense POS sizes; operational information should normally be at least 13px, and 12px is reserved for genuinely tertiary hints.
- Verify no horizontal overflow at 375px, 768px, and 1440px viewport widths.

## Responsive behavior

The product area is container-responsive rather than locked to an aesthetic column count.

Target behavior for the product pane:
- Under 600px: 1 column
- 600–899px: 2 columns
- 900–1279px: 3 columns
- 1280px and above: 4 columns if the product pane truly has enough room

A typical laptop with the current-order rail visible should naturally resolve to three product columns. Mobile retains the existing review/pay overlay workflow rather than forcing the desktop order rail on-screen.

## UI anti-patterns

Do not ship:
- pure-white canvas with no depth separation
- beige/brown palette drift
- glass on every surface
- nested cards
- oversized pill/radius styling on ordinary content
- bright emerald SaaS accents
- icon-only controls where the meaning is not immediately obvious
- decorative colored status dots without text/icon meaning
- fixed three-column layouts that break at other widths
- fake product descriptions or fake product images
- literal Apple visual cloning
- heavy shadows on every card
- motion that competes with cashier speed
- operational text compensated with excessive Semibold/Bold weight

## Design verification gate

Before merge, compare the implementation against the approved visual direction and this design system. Verify:
- logo fidelity
- color-token fidelity
- typography hierarchy
- product-card anatomy
- order-rail hierarchy
- primary CTA emphasis
- state semantics
- desktop/mobile overflow
- reduced motion
- light/dark coherence
- existing POS workflows and accessibility contracts
