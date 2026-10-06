# Pitchside 3D

## Register
product (game UI: menus, Ultimate Team screens, in-match overlays). Design serves play.

## Users and purpose
A group of school friends playing a browser football game (EA FC / FIFA Ultimate Team style) on school
Chromebooks and home laptops, often online against each other. The owner (Shawky FC) runs the game and its
admin tools. They judge every screen against the real EA FC 24–26 menus.

## Brand personality
Confident, fast, game-like. Real content first (player cards, pitches, stadium), plain game copy.

## Anti-references
Anything that "looks AI-made": purple/blue gradients, glassmorphism, gradient text, colored side-stripe cards,
emoji headings, three icon boxes in a row, buzzword copy, low-contrast dark mode, plain unstyled lists.
The owner's full list of 20 is in CLAUDE.md; using any of them needs the owner's approval with a screenshot.

## Design principles
- Look like EA FC: near-black charcoal (#0b0d10–#15181d), one accent used sparingly, white text.
- Show the real cards (meta/ui/card.js playerCard) wherever players appear; never a bare name list.
- Condensed upright display type for headings, clean sans body ≥ 14px, clear hierarchy.
- Motion 120–220 ms, purposeful, with reduced-motion fallbacks.
- Must work at 1366×768 (Chromebook), 390×844 (phone) and with keyboard / gamepad focus.
- Details: docs/UI_DIRECTION.md.
