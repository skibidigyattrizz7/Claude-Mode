# Prompts for other coding AIs

How to use: connect each AI to GitHub repo `skibidigyattrizz7/Claude-Mode`. Paste **the Shared Rules block first, then that AI's task block**. Each AI gets different files, so they can all run at the same time without clashing. Claude (this session) reviews and merges every branch.

---

## Shared Rules (paste into every AI)

```
You are working on "Pitchside", a browser soccer game in the style of EA FC / FIFA Ultimate Team.
Repo: github.com/skibidigyattrizz7/Claude-Mode. Base branch: claude/compassionate-gates-n9kfni (NOT main).
Live: https://skibidigyattrizz7.github.io/Claude-Mode/  (3D game: /3d/index.html, 2D game: /2d/index.html)

TECH: vanilla ES modules, no build step, no npm deps. Three.js r170 vendored in 3d/vendor/. Supabase backend (SQL migrations in supabase/). PeerJS WebRTC + Supabase Realtime relay for online.
Key folders: 3d/js/engine/** (match sim, AI, physics, rendering, HUD), 3d/js/meta/** (Ultimate Team: cards, packs, SBCs, draft, club, admin), 3d/js/net/** (accounts, online), 3d/css/**, 2d/**.

WORKFLOW RULES (must follow):
1. Create your own branch from claude/compassionate-gates-n9kfni named <your-ai-name>/<task>. Never push to claude/compassionate-gates-n9kfni or main. Open a PR into claude/compassionate-gates-n9kfni.
2. Only edit the files listed in your task. If you truly must touch another file, keep it tiny and explain in the PR.
3. Do NOT change 3d/js/net/** or supabase/** unless your task says so. The online system works; don't break it.
4. Never edit an already-applied Supabase migration. Never write admin codes/passwords into any file.
5. All tests must pass before you open the PR:
   for t in 3d/js/engine/tests/*.test.mjs 3d/js/meta/tests/meta.test.mjs 2d/tests/logic.test.mjs 3d/js/net/tests/net.test.mjs; do node $t | tail -1; done
   Add tests for any logic you change. Never delete or skip tests.
6. The match sim must stay deterministic (seeded random only, no Math.random in sim code).
7. Must run smoothly on a school Chromebook (weak GPU) and on phones (390x844 portrait, 844x390 landscape, touch controls). Tap targets >= 44px.
8. PR description: what changed, how to test, before/after screenshots (desktop 1366x768 + phone). Don't commit screenshots into the repo.
9. Keep the owner's language simple in any UI text. No em dashes (—) in UI text.

DESIGN RULES (owner hates "AI slop"; target = real EA FC 25/26 look):
- Read CLAUDE.md and docs/UI_DIRECTION.md in the repo first. Also read .claude/skills/ui-ux-pro-max/SKILL.md (UI/UX guidance) and use it.
- Do NOT use any of these without the owner's approval: purple-to-blue gradients, gradient text, emojis in headings, Inter font everywhere, colored-border cards, glassmorphism, low-contrast dark mode, 3 icon boxes in a row, badge above headline, Lucide icons everywhere, untouched shadcn, fade-in on scroll, cursor-following glow, buttons that only fade on hover, inconsistent spacing, em dashes, buzzword copy, serif italic accents, Space Grotesk + Instrument Serif, grain over gradient.
- Motion principles: animations should be fast (150-400ms for UI), use ease-out for entering, springy only where it adds feel (card flips, pack reveals), respect prefers-reduced-motion, never block input. Every animation must have a purpose (reveal, feedback, hierarchy).
- Polish principles: consistent 4/8px spacing scale, strong type hierarchy (bold condensed headings like FC), high contrast text, solid dark plates with team/brand accent bars, real card art style (FUT cards), no placeholder text.

GAME FEEL RULES (owner's preferences):
- Admin cards (id starts with "ad_" or rating > 99) are meant to be overpowered: incredibly fast, win the ball from anywhere, always max chemistry, hidden from swaps.
- Shooting stat 500+ = every shot from anywhere goes top corner and can't be saved, but the ball flight must look like a real powerful/curling shot from the moment it's struck.
- Real players use real info; unknown facts show "Unknown", never invented.
```

---

## Which AIs to use

| AI | Where | Give it |
|---|---|---|
| ChatGPT Codex | chatgpt.com/codex | Task A |
| GitHub Copilot coding agent | GitHub → Issues → assign to Copilot | Task B |
| Google Jules (Gemini) | jules.google | Task C |
| Cursor (background agents) | cursor.com | Task D |
| Devin | devin.ai (paid) | Task E |
| Any extra one (Claude Code on another account, Replit Agent, Windsurf) | — | Task F |

Claude (this session) keeps: mobile pass + admin Players/Moderation merge + editing saved admin cards + custom ban duration + security hardening (already half-done here).

---

## Task A — Player & goalkeeper animation (ChatGPT Codex)
```
Files: 3d/js/engine/render/player.js, 3d/js/engine/render/*anim* (new files ok), 3d/js/engine/tests/visuals.test.mjs.
Continue the branch chatgpt/player-animation work (already merged). Now:
1. Goalkeeper revamp: keepers currently dive with their back to the ball and fly diagonally/vertically in odd ways. Build realistic GK animations: set position, side-step shuffle, low dive (left/right), high dive with arm extension, diagonal top-corner dive, parry, catch-and-hold, smother at feet, punch, get-up. The keeper always faces the ball/shooter and dives side-on. Blend smoothly, no pops.
2. Celebrations: knee slide, arms out run, badge kiss, backflip-lite, "siu" jump. Pick randomly after goals.
3. Skill move animations: step-over, roulette, elastico, ball roll, heel-to-heel, rainbow flick, drag-back (visual side; the owner wants more skill moves, coordinate with Task C if inputs are needed).
4. Keep 22 players at 60fps on a Chromebook.
```

## Task B — Card Creator & Ultimate Team bugs (GitHub Copilot)
```
Files: 3d/js/meta/ui/customcards.js, 3d/js/meta/core/customreg.js, 3d/js/meta/core/admincards.js, 3d/js/meta/ui/utview.js, 3d/js/meta/core/squad*.js / chemistry.js (rating only), 3d/js/meta/ui/giftbox or wherever the gift inbox UI lives (find it), 3d/js/meta/tests/meta.test.mjs.
Fix:
1. Card name "pain man" saves as only "man". Keep the full name (first + last, any number of words).
2. Creating an admin goalkeeper saves it as 65 OVR with every stat 65. GK stats (DIV/HAN/KIC/REF/SPD/POS) must save exactly as entered.
3. A card can't have more than 3 alternative positions. Allow any number.
4. Squad rating shows an old value (96) when the team is now 99. Recalculate on every squad change/load.
5. Gift inbox: add a "Claim all" button.
6. Sending gifts on laptop says "needs_super" but works on phone. Find why the client sends a different flag/state on desktop (UI only; do NOT change net/** or supabase/** — if it needs a server change, explain in the PR).
```

## Task C — Shooting, power shot, finesse, skill moves input (Google Jules)
```
Files: 3d/js/engine/core/sim.js (shooting/ball physics parts), 3d/js/engine/core/physics*.js, 3d/js/engine/core/ai.js (GK save logic only), 3d/js/engine/ui/input.js, 3d/js/engine/tests/gameplay.test.mjs + physics.test.mjs.
1. Add a Power Shot (e.g. hold shoot + modifier): low, driven, very fast, takes a moment longer to wind up.
2. Rework Finesse (curl) shots: realistic curve (Magnus-style sidespin), dips into the far corner. Curved shots currently look bad.
3. Shooting 500+: every shot from any distance/angle/type goes top corner and is unsaveable, but the ball must look like a proper hard/curling shot from the moment it leaves the foot (no slow pass that suddenly flies). Right now a 999-shooting card gets saved even from its own half.
4. Timed finishing only for penalties. Remove it from free kicks and everything else.
5. More skill moves (inputs + sim effect): step-over, roulette, elastico, ball roll, heel-to-heel, rainbow flick, drag-back, fake shot. Map to keyboard, gamepad and the touch SKILL button (tap/hold/swipe).
Keep sim deterministic. Add tests.
```

## Task D — FUT Draft redesign (Cursor)
```
Files: 3d/js/meta/ui/modesview.js (draft section), 3d/js/meta/core/draft.js, new 3d/js/meta/ui/draftpick.js, new 3d/css/draft.css, meta tests.
Owner feedback: "looks like a slideshow, not centered, draft chances suck, no subs".
1. Captain pick: 5 cards centered on screen, dealt left→right one by one with a flip + small landing bounce (like FIFA). Chosen card flies into its slot.
2. After captain: pitch is the main screen. Click ANY empty position in any order → centered picker overlay with 5 cards for that position, dealt left→right with the same animation, each showing chem preview. Back button to cancel. Re-opening a slot shows the same 5.
3. Better odds: usually at least one 85+ per pick, real chance at 88-91+, occasional promo/icon. Captain choices all 84+, usually one 90+. Some options match nations/leagues already in the squad so high chem is possible. Put odds in one config + test the distribution.
4. Add a 7-player bench (subs), picked the same way. Draft is complete only when XI + subs are filled. Pass subs to draft matches if the match setup supports a bench.
5. Works on phones (cards scale or 3+2 grid).
```

## Task E — Pack opening on Chromebooks + bulk buttons (Devin)
```
Files: 3d/js/meta/ui/packopen*.js, 3d/js/meta/ui/walkout3d.js, 3d/css/packs.css, meta tests.
1. On some laptops/Chromebooks the pack stage is blank (blue glow, Skip button stuck at the top edge, page scrollbar). Make the overlay a true fixed full-screen layer, detect weak/missing WebGL and fall back to a 2D FC-style walkout (nation flag → position → club badge → card flip), with a hard 1.5s timeout fallback so a pack ALWAYS reveals. Test at 1366x768 and 1280x800, DPR 1, and with WebGL disabled.
2. Pack results screen: add "Send all to SBC storage" and "Send all to transfer list" buttons (use the existing store functions).
3. Remove the big empty space after pack openings; best card first.
```

## Task F — Online pre-match lineup reveal + team AI (extra AI)
```
Files: new 3d/js/engine/ui/lineupreveal.js (+ its CSS inside the module), a one-line hook where online matches start (find it in 3d/js/main.js or engine/index.js; do NOT edit 3d/js/net/**), 3d/js/engine/core/ai.js for part 2.
1. Before an online match, show the opponent's team like FIFA, animated: first the goalkeeper, then the defence, then midfield, then attack, then the whole team on a pitch graphic with rating/chem. Skippable. Phone friendly.
2. Team AI tactics (engine/core/ai.js): compact defensive block that shifts with the ball, pressing triggers (back pass, bad touch), full-backs overlapping, third-man runs, strikers running in behind, keeper sweeping. Difficulty levels still feel different. Keep sim deterministic; add gameplay tests.
(If Task A/C are also editing ai.js, do part 1 only.)
```

## Sep 30: FIFA / FC card designs (split: Claude = card design system + photos, ChatGPT = promos, Grok = secret-card art)

### ChatGPT (Codex, with GitHub access): promos
```
Repo skibidigyattrizz7/Claude-Mode, game in 3d/ (vanilla ES modules, no build). Read CLAUDE.md, docs/HANDOFF.md first.
Work on your own new branch; Claude merges it. Use subagents / parallel tasks if you can (one for data, one for tests).
Owner decision: this is a non-commercial fan game, so real EA promo names and EA card designs are allowed.
Task: add every FIFA 23 promo campaign to 3d/js/meta/core/promos.js (same shape as the existing entries: id, name, short,
tag, colors, range, price, theme, release week, pack, SBCs) and give each a `design` field naming its card background:
Team of the Week, Ones to Watch, Road to the Knockouts, Rulebreakers, Out of Position, World Cup Path to Glory,
Road to the World Cup, World Cup Stories, World Cup Phenoms, World Cup Team of the Tournament, Winter Wildcards,
FUT Centurions, Team of the Year, Future Stars, Road to the Final, Showdown Series, Fantasy FUT, FUT Ballers,
FUT Birthday, Trophy Titans, TOTS Warm-Up Series, Team of the Season, Shapeshifters, Level Up, FUTTIES, Pre-Season.
Existing promos with a fictional name that match one of these: keep the SAME id (old saves), just change the name/tag to
the real one (e.g. rulebenders -> Rulebreakers, frost -> Winter Wildcards, cupstories -> World Cup Stories).
Design keys = files in 3d/assets/cards/<key>.webp (FIFA 23 = f23-<EA rarity id>). Known: TOTW f23-3, TOTY f23-5,
MOTM f23-8, TOTS f23-11, Icon f23-12, FUTTIES f23-16, OTW f23-21, FUT Birthday f23-30, Flashback f23-51,
UCL RTTK f23-47, Winter Wildcards f23-118, World Cup Icon f23-129, Centurions f23-151, Trophy Titans f23-156,
Rulebreakers f23-149. For the rest, open the images in 3d/assets/cards and pick the one that matches the promo.
Do NOT edit card.js / meta.css / 3d/js/net/** (Claude is changing those). Promo draws must stay diverse
(buildPromoCards usage map). Run node 3d/js/meta/tests/meta.test.mjs and add tests for the new promos.
```

### Grok (Expert mode; Heavy only with SuperGrok): secret and admin card art
```
Make card background art for a football card game in the exact style of EA SPORTS FC 26 Ultimate Team special cards
(shield-shaped card with the notched top corners, ornate thin metallic frame, dramatic artwork in the top 60%, a calm
darker band in the lower 40% where name and stats go, NO text, NO player, NO numbers). Portrait 840x1200, card shape on a
transparent or pure black background. If you can, work on several at once (subagents / parallel generations).
1. "The Shawky" - glitch / infinity god card: black and electric cyan, digital glitch shards, an infinity sign.
2. "Cursed -infinity" - blood red and black, cracked obsidian, dripping red, evil glow.
3. "Hell" - fire and molten lava, charred frame.
4. "Angel" - white marble and gold, soft light rays, feathers.
5. "E.L.I.J.A.H." - deep purple cosmic nebula with gold runes.
6. "Admin Card" - black and gold circuit board with a crown.
7. "Rabbi Patel" - royal blue and white with gold, a Star of David in the art.
Give each as a separate PNG named like shawky.png, cursed.png, hell.png, angel.png, elijah.png, admin.png, rabbi.png.
```
