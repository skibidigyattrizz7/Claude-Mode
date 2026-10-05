# Handoff guide: how we work on this project

Read this, `CLAUDE.md` and `docs/BACKLOG.md` at the start of every new chat. This is the "how", the backlog is the "what".

## 1. The owner
- Owner: "Shawky FC" (in-game accounts "Shawky FC" / "Phonk Mode Fc"). Friend who plays online: "Collins FC".
- Wants EA FC / FIFA quality, not "AI slop". Gets frustrated by stale or broken features, so verify things work before saying they do.
- Wants **short, simple answers**. Wants a list of what's done / in progress / next when asked.
- Usage is tight. Be efficient: batch work, few agents, no chatter. See "Saving usage" in CLAUDE.md.
- "Notes mode": if the owner says something is "for saving" / "save for later", append to `docs/BACKLOG.md`, commit, push, reply "Saved". Don't start work on it.
- If the owner says **stop**: stop all agents (TaskStop), save unfinished work to a side branch, push nothing untested to the main branch.
- The owner can override "don't push untested" ("push it now I don't care"). Then push, and say clearly that it's untested.
- **Won't help with**: getting the game past the school web filter (proxies, mirrors, disguised domains, cloud-bucket tricks). Offer the honest route instead (teacher asks the district filter admin to allow it).

## 2. The project
- Repo `skibidigyattrizz7/Claude-Mode`. **Work branch: `claude/compassionate-gates-n9kfni`** (PR #1 into `main`). `main` is old; don't use it.
- Two games, vanilla ES modules, **no build step**, no npm deps:
  - `2d/`: Touchline 2D (`2d/tests/logic.test.mjs`).
  - `3d/`: Pitchside 3D (Three.js r170 vendored in `3d/vendor/`), FIFA-style with Ultimate Team, Career, online.
- Key folders in `3d/js/`:
  - `engine/**`: match sim (`core/sim.js`, `core/ai.js`, physics), rendering (`render/player.js`, `render/ball.js`), HUD (`ui/hud.js`), goal card (`ui/goalcard.js`). The sim must stay **deterministic** (seeded RNG only).
  - `meta/core/**`: UT data and rules (players, `realplayers.js`/`realregulars.js`/`bios.js`, chemistry, packs, SBCs, draft, swaps, `admincards.js` (ids `ad_`), `secretcard.js` (The Shawky + 7 other secret versions), `adminvault.js`).
  - `meta/ui/**`: UT screens (`utview.js`, `card.js`, `art.js` flags/badges, `packopen*.js`, `adminview.js`/`adminextra.js`/`ownerpanel.js`, `customcards.js` Card Creator, `modesview.js` Draft).
  - `net/**`: accounts + online. **Don't change unless really needed.** Supabase RPCs in `services.js`, PeerJS WebRTC in `transport.js`, with a **Supabase Realtime relay fallback** in `relay.js` (kicks in if the direct link doesn't open in 5 s). Matchmaking search has no timeout.
- Docs: `BACKLOG.md` (to-do), `AI_PROMPTS.md` (prompts + shared rules for other AIs), `UI_DIRECTION.md` (art direction), `PACK_BRIEF.md`, `PROMO_BRIEF.md`, `ONLINE_API.md`, `META_API.md`, `3D_CONTRACT.md`.

## 3. Branches
- `claude/compassionate-gates-n9kfni`: live code.
- `wip/paused-work`: merged into the live branch and tested (2026-09-29). Its security migration 008 is parked in `supabase/drafts/` and **not applied**.
- `wip/shawky`: snapshot of The Shawky work (already pushed to the live branch since).
- `chatgpt/*`: ChatGPT's branches. Review, test-merge in a worktree, merge (leave out screenshot folders).

## 4. Tests (run before every push)
```
for t in 3d/js/engine/tests/*.test.mjs 3d/js/meta/tests/meta.test.mjs 2d/tests/logic.test.mjs 3d/js/net/tests/net.test.mjs; do echo "$(basename $t): $(node $t 2>&1 | tail -1)"; done
```
All must pass. Add tests for logic you change. Never delete/skip tests.

Browser checks (Playwright is preinstalled):
```js
import pw from '/opt/node22/lib/node_modules/playwright/index.js'; const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
```
Serve the repo with `python3 -m http.server <port>`. Useful pages: `3d/index.html`, `3d/meta-test.html?view=ut`, `3d/engine-test.html?ai=1`, `?mockOnline=1` for a fake online backend. Check desktop 1366x768 **and** phone 390x844 / 844x390. The sandbox can't open WebSockets (PeerJS/Supabase realtime), so live online play can't be tested here.

Owner videos/screens: extract frames with
`/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2 -i in.mp4 -vf "fps=1/2,scale=288:-1,tile=4x3" -frames:v 1 sheet.png`, then Read the png.

## 5. Git rules (learned the hard way)
- **Never `git commit -a` / `git add -A` / `git add .` while agents are working.** It once swept an agent's half-finished files into a commit. Commit by explicit path; check `git diff --cached --name-only` first.
- Safe push when agents have uncommitted edits: `git worktree add /tmp/wt origin/claude/compassionate-gates-n9kfni`, merge the finished commit(s) there, run tests, `git push origin HEAD:claude/compassionate-gates-n9kfni`, remove the worktree.
- Snapshot uncommitted work to a side branch without touching the working tree: temporary index (`GIT_INDEX_FILE=/tmp/idx git read-tree HEAD && git add -A && git write-tree`), `git commit-tree`, push to `refs/heads/wip/<name>`.
- No model names in commits/PRs. Commit trailer: `Co-Authored-By` + `Claude-Session` lines (see system reminder).
- The stop hook nags about uncommitted changes; it's fine to leave in-progress agent files uncommitted.

## 6. Supabase (project `baxzjrueelirgcstjbdc`)
- All game data goes through SECURITY DEFINER RPCs named `pitchside_*`. RLS on, no table grants, fixed search_path, and a privileges block re-run at the end of each migration. Admin codes are stored bcrypt-hashed only.
- New server change = **new migration file**. Apply with the Supabase MCP `apply_migration`, then **rename the file to the version Supabase recorded** (`list_migrations`), so the GitHub Supabase Preview check passes. Never edit an applied one.
- Pending draft: 023 vinson_reset in supabase/drafts/ (owner-only Reset Vinson), not applied yet.
- Applied: 001 `20260925140338`, 002 `20260926000000`, 003 `20260926000100`, 004 `20260926070546`, 005 `20260927005601`, 006 `20260927010300`, 007 `20260927160223`, 009 `20260928204017` (owner account = Owner Access). 008 is parked in `supabase/drafts/`.
- Test gifts used to stay claimable; expired with `update pitchside_gifts set expires_at = now() where expires_at > now()`.

## 7. Hosting
- Owner (Sep 29): **ignore Render and Vercel** from now on: don't mention, check or update them. GitHub Pages is the live game.
- **GitHub Pages** (live, auto): https://skibidigyattrizz7.github.io/Claude-Mode/
- **Test link** (owner, Sep 29): add `?test=1` to any of these, e.g. https://skibidigyattrizz7.github.io/Claude-Mode/3d/?test=1 . js/testmode.js swaps all storage for memory (nothing saved, reload = clean slate), forces the fake online server (?mockOnline=1, never the real DB) and turns on Owner Access.
- **Live test link** (owner, Oct 1): https://skibidigyattrizz7.github.io/Claude-Mode/3d/?livetest=1 . js/livetest.js puts every save in its own storage section ("pitchside.livetest::"), so it starts as a new guest and never touches the real club, survives reloads (aftermath screens work) and uses the REAL server, so the owner can target the test guest with admin commands from another account. Banner: Reset (new guest) / Exit.
- **Replit** (manual copy, does NOT auto-update): https://vital-flustered-codegeneration--ziadaymanshawky.replit.app. Updating it costs the owner's Replit credits.
- All are blocked on the owner's school Chromebook (filter category "domain sharing"). Don't try to bypass it (see section 1).

## 8. Agents
- Max ~3 long agents + small ones. Use **Sonnet** (or Haiku for tiny tasks) via the Agent tool `model` param; not the newest Opus.
- Each agent prompt must list: the files it owns, files it must NOT touch, "commit only your files by explicit path, don't push", the test command, the Playwright setup, where to save screenshots, and CLAUDE.md design rules.
- Agents that hit the usage limit die mid-task. Resume them with SendMessage (keeps context) instead of relaunching.
- Other AIs: the owner only has ChatGPT (Codex). GitHub Copilot isn't enabled on the account. Prompts are in `docs/AI_PROMPTS.md`.

## 9. Known gotchas and past fixes
- Admin card flags: `id` starting `ad_` or rating > 99 → max chem, hidden from swaps (`chemistry.js isAdminChem`, `swaps.js`).
- `bad_target` on admin gift/moderation came from sending usernames instead of UUIDs; the server now resolves usernames and friend codes.
- Card grants failed because `UT.registerCustomCard` didn't exist, so there's now `core/customreg.js`.
- Account chip icon was huge from late-loading CSS, so it has fixed size attrs + a cache-bust on `account.css`.
- Real players must use real facts; unknown facts show "Unknown" (`bios.js`). Test: every BIOS key must be a real player. Removed Ahmed Refaat (died 2024).
- "Couldn't download the 3D files" on the Chromebook came from an S3 mirror/proxy missing files, not our site.
- Online "connect failed": the likely cause was restrictive networks, so we added TCP/TLS TURN servers and the Supabase relay fallback. This is untested live.
- Secret card (The Shawky, EGY): only from the Secret Vault (0.1% each) or the Admin Vault (0.5%), never admin-grantable. Pushed untested on the owner's request, so if something's broken, check this first.

## 10. How a good turn looks
1. Read the request, then check `BACKLOG.md` for related notes.
2. Small fix: do it yourself. Bigger: one Sonnet agent with a tight file list.
3. Test (node suites + a Playwright screenshot for UI).
4. Push via the safe procedure, update `BACKLOG.md` (move items to done), reply in 2–5 short lines.

## Claude prototype 13 (Oct 2, latest)
Live at /3d/prototypes/claude-13/ (owner refreshes the same link; bump every `?v=13x` import together when files change:
index.html imports sim/render/sfx, render.js imports sim.js, sim.js imports script.js — mismatched versions = two module copies).
Modes: normal / hard / extreme. Finishers: FIN_NAMES + FIN_POOLS in sim.js, visuals in render.js drawFinisherWorld branches.
Tests: scratchpad smoke13.mjs <mode> (all forced runs should end in victory; 'mortal' run ends in defeat), boxbot13.mjs <mode> <lat> claude-13 <act>.
Gotcha: never append code after a `//` comment on the same line (it silently disables it; this happened once).
Secret phase-3 code: only its FNV-1a 32-bit hash + length live in claude-13/sim.js (SECRET). To change it, hash the new
code in UPPERCASE with fnv() from sim.js and replace SECRET.hash/len (and the sky hint order in render.js SKY_ORDER if the
pattern changes). Never write the code itself into the repo.

## P13 dev mode (Oct 5)
- `3d/prototypes/claude-13/dev.js`: DEV MODE screen. Overrides live in localStorage `p13dev` ({v: {path: value}, img: {boss1..hero3: dataURL}}) and are applied by `applyDev()` onto the exported objects (STAGES, MODES, ABIL, FIN, FIN_NAMES, MISS, TUNE in sim.js; SCRIPT; P palettes in render.js). Pictures go to `CUSTOM` in render.js (drawBoss/drawHero draw them instead of the built-in art).
- `TUNE` in sim.js holds what used to be constants (hero max HP, heal, heals per phase, Star of Hell chance, ability damage/cooldown multipliers, camera zoom `view`). Add new tunables there and a field in dev.js `sections()`.
- dev.js imports must carry the same `?v=` as the other files (the version sed covers it).
