# EVIL VINSON HELL card and curse

This branch now includes the card, artwork, timed curse UI, server-backed ban/release, squad lock, pack curse, and match rejection. It does not alter the unrelated pack-opening cinematic or the football engine.

## Stable contract

- `HELL_CARD_ID` from `3d/js/meta/core/secretcard.js` is `secret_vinson`. Resolve with `secretCard(HELL_CARD_ID)` or `getPlayer(HELL_CARD_ID)`; the card has `hell === true`, `special === 'secret'`, `cardTag === 'WORSE THAN THOMAS'`, and is **not** `evil` or `cursed`.
- `3d/js/meta/ui/card.js` adds the `.is-hell` card class; the card face and expanded attribute block display `???`. The underlying stats/overall remain finite for math. Do not use the visible string in gameplay calculations.
- The artwork lives at `3d/assets/cards/evil-vinson.png` (portrait), `vinson-warning.png` ("IT'S NOT WORTH IT" image), and `vinson-planet.png` (planet image). In the 3D app, URLs are relative to `/3d/`: `assets/cards/<name>.png`.
- It has its own chance in Secret Vault and Admin Vault, just like every other Secret version. An actual pull starts the event. A locked squad turns every result card in subsequent packs into Vinson.

## Sequence and deployment

The owner role is exempt on the server. Other players get a three-minute deadline tied to their account/guest profile. At expiry, the screen blacks out; the supplied warning image appears in four corners, duplicates until it fills the screen, then blackouts into the planet image. A circular cropped layer rotates the Earth independently of the woman. The final message is "YOU'VE BEEN STRUCK BY THE WRATH OF VINSON". The account's normal API calls and login status see the ban even after reloading. The owner can use the existing Owner > Players > Unban control; a moderator cannot clear this curse.

After release, placing Vinson in the squad starts a 5-second "IT'S NOT WORTH IT" warning, followed by a 10-second "THIS ACTION WILL HAVE CONSEQUENCES" warning. The original wording also says "within 10 seconds" and "countdown to 5"; this branch interprets that as **5 + 10 seconds** (15 total). Removing the card at any time before the end cancels the lock. Afterward the pinned position is restored on squad edits/switches, the account save RPC rejects saves that remove Vinson from the active squad, every card in a pack is Vinson, and starting a game is rejected with "VINSON HAS KILLED YOUR ENTIRE TEAM. YOUR SQUAD ISN'T ELIGIBLE TO PLAY."

Migration `supabase/migrations/20260929193627_pitchside_011_vinson.sql` is already applied on the live project (2026-09-29). The mock backend and targeted logic/account tests mirror the RPCs. Browser visual inspection is still required on a device that can access the game; this workspace's browser blocks local server URLs.
