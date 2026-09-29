# EVIL VINSON HELL card: effects handoff

This branch supplies only the card identity, face, stats display, and the owner's three images. It does not implement the curse, animation, ban, unban, or any network/server behavior. Merge it before working on those effects.

## Stable contract

- `HELL_CARD_ID` from `3d/js/meta/core/secretcard.js` is `secret_vinson`. Resolve with `secretCard(HELL_CARD_ID)` or `getPlayer(HELL_CARD_ID)`; the card has `hell === true`, `special === 'secret'`, `cardTag === 'WORSE THAN THOMAS'`, and is **not** `evil` or `cursed`.
- `3d/js/meta/ui/card.js` adds the `.is-hell` card class; the card face and expanded attribute block display `???`. The underlying stats/overall remain finite for math. Do not use the visible string in gameplay calculations.
- The artwork lives at `3d/assets/cards/evil-vinson.png` (portrait), `vinson-warning.png` ("IT'S NOT WORTH IT" image), and `vinson-planet.png` (planet image). In the 3D app, URLs are relative to `/3d/`: `assets/cards/<name>.png`.
- It has its own chance in Secret Vault and Admin Vault, just like every other Secret version. This branch does not change pack-opening presentation or special triggers.

## Remaining effects, for Claude's separate branch

On a successful new pull of `secret_vinson`, check the authenticated owner identity **server-side**, not just a client-provided club name; exempt owner Shawky Fc. For a non-owner, show the blood-styled "DOOM HAS BEEN BROUGHT UPON YOU" warning and a real persisted three-minute deadline. At expiry, show the black/warning-image multiplication sequence, then the spinning planet image and "YOU'VE BEEN STRUCK BY THE WRATH OF VINSON". A real ban/unban requires authorized server state; client-only flags are not a ban. Rejoin/reload should not bypass it.

After the owner unbans someone, squad placement should trigger the requested removable warning periods before a permanent slot lock. The request mentions both a 10-second removal window and a countdown to 5 on placement; confirm the exact timing with the owner before implementing an irreversible lock. After lock, opening a pack should yield the requested curse presentation, and starting a game should reject the squad with the corrected message: "VINSON HAS KILLED YOUR ENTIRE TEAM. YOUR SQUAD ISN'T ELIGIBLE TO PLAY." Handle saved squads, inventory and cross-device state; do not rely on a visual overlay alone.

Keep the effect code isolated from the card style. None of these effects are live in this branch.
