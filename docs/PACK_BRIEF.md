# Pack opening redo — brief from owner's reference videos (FUT 17/18/19 style)

Reference contact sheets (local only): scratchpad `frames/v1.jpg v2.jpg v3.jpg`.

## Flow (all in 2D DOM/CSS + canvas particles; a 3D player only at the very end for walkouts)
1. **Screen fades to black**, then a dark stadium tunnel/stage with a dim floor line of light.
2. **Pack drops in / rises centre stage** and is **ripped open from the top** (a foil strip tears off the top edge, left→right, with sparks) — never split into pieces.
3. **Light column / shower of sparks** coloured by best rarity (gold sparks = gold, blue = promo, purple/pink = special). Intensity scales with best rating ("tell" players learn: no sparks = nothing, gold rain = good, fireworks = walkout).
4. **Card silhouette** rises from the pack, hidden (backside/blank, rarity coloured).
5. For **walkouts (≥86 or promo)**: two tall **banners** slide in either side of the card (stage like the videos): reveal sequence one at a time, each with a punch + camera shake:
   - **Nation flag** (banners + card show flag),
   - **Position** + **rating** (big numbers on banners),
   - **Club crest** (large spinning crest coin, then on banners),
   - fireworks + smoke across the stage floor,
   - **card flips in** with name/face/stats.
   Then (optional, only if 3D loads fast) the player (engine rig, user club kit, his number) walks in beside the card, one simple celebration, stands. Skippable at any time (tap/Space). No 3D model right after the pack opens.
6. Non-walkout cards: quick reveal (flag → card) with small side fireworks; then the grid summary as now.
7. Promo packs: same flow, promo's theme colours on stage, banners, sparks.

## Rules
- Keep old animation available: setting `packAnim: 'classic' | 'new'` (default new) so owner can revert.
- 60 fps on a Chromebook; no big assets; no trademarks/real logos (generated crests/flags only as today).
- Only touch `3d/js/meta/ui/packopen*.js`, `walkout3d.js`, `3d/css/packs.css` (+ a setting toggle).
