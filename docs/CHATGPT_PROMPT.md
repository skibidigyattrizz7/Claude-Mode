# Prompt for ChatGPT (data work, paste as-is)

You're helping with a browser soccer game (FIFA/FC Ultimate Team style). I need DATA only, no code. Output plain JSON arrays I can paste in. Be accurate; if you don't know a fact, put null — never invent.

1) Egypt 2026 World Cup squad (26 players, latest known) + 15 best Egyptian players ever (e.g. Salah, Aboutrika, Hossam Hassan, Essam El-Hadary, Hany Ramzy, Ahmed Hassan, Wael Gomaa, Mido, Zidan, Hazem Emam, Trezeguet, Elneny...).
   Row format: ["id_lowercase_nospaces","Full Name","Surname","EGY","MAINPOS",["ALT1","ALT2"],"R|L foot",OVR,age_or_null,skillMoves1to5,"club or LEGEND"]
   Positions: GK CB LB RB LWB RWB CDM CM CAM LM RM LW RW ST CF. Legends rated at their peak (OVR 80–93 range, realistic).
   Exclude anyone who has died (e.g. Ahmed Refaat).
2) Bios for those players: {"id": "DOB YYYY-MM-DD|height_cm|foot"} — null for unknown parts.
3) 60 short football commentary lines split by event: goal, long-range goal, header goal, save, miss, foul, yellow card, red card, kickoff, half time, full time. Max 12 words each, no em dashes, no cringe.
4) FUT Draft odds suggestion: for a 5-card pick, a table of rating bands (75–79, 80–84, 85–87, 88–90, 91+) with probabilities that make a strong squad possible but not guaranteed; captain pick separately.

Return each section as its own code block.

---

# Hard work prompt (paste as-is; best in ChatGPT/Codex with GitHub access)

Repo: github.com/skibidigyattrizz7/Claude-Mode, branch `claude/compassionate-gates-n9kfni`. Vanilla ES modules, no build step, Three.js r170 vendored in `3d/vendor/`. Live: skibidigyattrizz7.github.io/Claude-Mode/. Read `CLAUDE.md` and `docs/UI_DIRECTION.md` first. Rules: don't touch `3d/js/net/**` or `supabase/**`; don't use the 20 "vibecoded" patterns in CLAUDE.md; tests must pass: `for t in 3d/js/engine/tests/*.test.mjs 3d/js/meta/tests/meta.test.mjs 2d/tests/logic.test.mjs 3d/js/net/tests/net.test.mjs; do node $t | tail -1; done`. Work on a NEW branch `chatgpt/<task>` and open a PR into `claude/compassionate-gates-n9kfni`. One PR per task.

Tasks (hardest first; do as many as you can):

1. **Player animation (3D)** — `3d/js/engine/render/player.js`. Players look stiff. Build a procedural skeletal animation system: run cycle with speed-blended stride, sprint lean, jog-to-stop, turn/plant, shooting (backswing → strike → follow-through timed to the kick event), passing, heading jump, slide tackle, GK dive (left/right, high/low), celebration set (knee slide, arms out, backflip-lite). Blend between states smoothly (no pops). Keep it cheap: 22 players at 60fps on a Chromebook. Add a test in `3d/js/engine/tests/visuals.test.mjs` for state selection.

2. **Team AI tactics** — `3d/js/engine/core/ai.js`. Make teams play like FC: compact defensive block that shifts with the ball, pressing triggers (back pass, bad touch), fullbacks overlapping, midfield third-man runs, strikers running in behind when a teammate has space to play a through ball, keeper sweeping. Difficulty levels must still feel different. Don't break determinism (sim must stay seeded). Add gameplay tests.

3. **Pack opening on low-end laptops/Chromebooks** — `3d/js/meta/ui/packopen*.js`, `walkout3d.js`, `3d/css/packs.css`. Bug: on some laptops/Chromebooks the pack stage is blank (blue glow, Skip button at top edge, page scrollbar). Make the overlay a true fixed full-screen layer, detect weak/no WebGL and fall back to a 2D FC-style walkout (nation flag → position → club badge → card flip) that's still exciting, with a hard 1.5 s timeout fallback. Test at 1366x768 and 1280x800, DPR 1.

4. **Promo card designs** — `3d/js/meta/ui/card.js` + `3d/css/meta.css`. Make promo cards look like real FC 26 promos (TOTY, TOTS, Future Stars, Flashback, Icons, Heroes, Road to the Knockouts). Layered SVG/CSS backgrounds, foil shimmer that's subtle, correct text contrast. No gradients purple→blue, no glassmorphism.

5. **FUT Draft** — draft screen in `3d/js/meta/ui/modesview.js` / `3d/js/meta/core/draft.js`. Click any pitch slot → 5 cards dealt left→right with flip animation, centered; captain pick centered; better odds (usually one 85+, real chance of 88–91+); 7 subs on a bench. (Coordinate: skip if a PR for this already exists.)

For each task: short PR description with before/after screenshots.
