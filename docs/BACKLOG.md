# Owner backlog (source of truth for agents — read your section only)

Owner's account name in game: **"Shawky Fc"** (owner). Test account: "Phonk Mode Fc".
Live site: GitHub Pages + https://claude-mode.vercel.app (Vercel mirror; use for school Chromebook).
Supabase project live (migration 001 applied). **Do NOT break the working online system** (code rooms, quick search, market) — change it only where a task below requires.

## A. Accounts, admin, owner powers, social — `3d/js/net/**`, `supabase/**`, account/admin hooks in `3d/js/main.js`
1. Real login: username + **password**, sign up / log in / **sign out**, **change username**. No two people on one account. Existing device profiles can be claimed.
2. Two **permanent** admin codes (owner only): the existing full code, and a new **SUPER** code = everything the full code does + admin cards (up to 999 OVR) + strongest powers. Temp code (60 min, limited) stays. Codes never stored in plain text (server bcrypt; client PBKDF2 constants given by coordinator).
3. Owner powers (full/super code or owner account): reset any player's coins / progress / club; ban/unban; grant admin (mod role); **global messages** (banner to everyone online); **giveaways** ("Roblox admin abuse": give coins/packs/players to one user or everyone); gifts inbox for receivers; toggle any card tradable/untradable; granted cards must be **tradable**.
4. **Global game config** editable in-game by owner (no need to ask Claude): promos on/off (each), packs enabled/disabled in the shop, pack prices, reward multipliers, market tax. Clients read config at startup + every few minutes.
5. Coins bugs: online balance glitchy; admin give-coins sometimes fails; local "infinite money" shows but purchases say "not enough coins"; adding to local balance broken. One consistent balance model.
6. Transfer market: sold players stay in a "collect" list, lag, and pay nothing → **remove claim; credit seller instantly on sale**; sold listings disappear.
7. Online players counter on the site. View other players' squads. Simple messages (DMs) incl. small pictures (keep it simple/cheap).
8. Post-match rewards (coins always; packs occasionally, rarer) with FIFA-style coin count-up.
9. Guest/host in-match admin trolling (token-verified) — keep.

## B. UT content & rules — `3d/js/meta/core/**`
1. Re-evaluate ALL real-player ratings realistically (e.g. Cannavaro 2006 Ballon d'Or ≈ 96–97, not 93). Top 100 players get OP **Admin cards** (admin-only, up to 999, extra PlayStyles).
2. +500 more real players (incl. many real **defenders**), fictional-but-recognisable clubs (e.g. "Manchester Blue" sky-blue crest) — close, not copyrighted.
3. **Secret card** only in a unique pack at 0.0005 odds; admins can't grant it.
4. **Admin card creator**: custom name/stats/nation/club/position/rating + upload PNG face/art.
5. Promos: more promos, nerf a bit, promo cards can drop from any pack (lower chance); more card variants so packs aren't repetitive.
6. AI market: realistic, varied, enough high-rated players; no absurd 99 CBs.
7. No duplicate player (any version) in one squad. Alt positions must be sensible (Messi can play RM/RW/CAM/CF/ST).
8. **Manager** cards for chemistry; optional FC26-style chemistry (no adjacency) toggle.
9. Fix: can't play vs AI teams in UT (Squad Battles/Rivals AI).

## C. UT UI — `3d/js/meta/ui/**` (except pack opening), `3d/css/meta.css`
Squad builder redesign (smooth, non-laggy switching, good-looking pitch). FC-style icons/logos per tile. Full Admin panel UI for everything in A/B (global messages, giveaways, resets, config toggles, card creator with PNG upload, tradable toggle, moderation). Gifts inbox, reward screen + coin count-up. Hover animations. Less "AI-looking" UI.

## D. Pack opening — `3d/js/meta/ui/packopen*.js`, new `walkout3d.js`, `3d/css/packs.css`
Camera moves forward down a tunnel/hallway; pack appears, **rips open**, card is pulled out (card hidden until reveal); keep the summary text after. Normal cards: no walkout — country → position → club reveal, small side fireworks. **Walkouts ≥86**: distinct look players recognise without words; 3D player (engine renderer rig) walks out, does a couple of skills, stands hands behind back (FC26). Each promo: unique animation + themed background colours (FC Mobile style); player wears his number / the user's club kit.

## E. UI overhaul — `3d/css/main.css`, `3d/index.html`, `/index.html`, `2d/style.css`, new `3d/css/tokens.css`
Human-designed look (reference: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), hover animations, consistent tokens other agents can import.

## F. 2D gameplay + 2D online — `2d/**` (except `2d/style.css`)
Passing still weak; receiver free-roams; AI passes perfect vs user's weak; add AI defending + AI marking for user's team; user's teammates must actually intercept. More kit designs (no clashes). **2D online mode** using the same PeerJS code-room approach (vendored `3d/vendor/p2p-net.min.js`).

## G. 3D engine — `3d/js/engine/**`
Receiver free-roam; weak passes; AI defending/marking + interceptions for user team; 3D doesn't load on school Chromebook/proxy → robust loading + fallback + clear errors; **stadiums load faster**; more kit designs; walkout needs a reusable rig API for D.

## New owner requests (Sep 26)
- Super admin code was changed (client hash updated in `3d/js/shared/adminauth.js`; server hash inserted by coordinator). It "didn't work at all" before — verify the whole flow end-to-end in the UI.
- **SBC storage vault**: untradable duplicates go to an SBC storage (max 200, duplicates allowed) usable in SBCs.
- **Send to transfer list** without listing (FUT "transfer list" pile), list from there later.
- Transfer market + coins + **market refresh** bugs still broken — must be fixed and proven.
- Promo view says some cards "release in a couple weeks" but those players are already in the AI market → unreleased promo cards must not appear anywhere (market, packs, SBC rewards) until released.
- More promos (each with its own pack-opening theme like the existing ones).
- Tactics editor must be visible/reachable in UT and in-match.
- Redo ALL UIs: FC-quality, interactive, clean (3D menus, UT, 2D, landing) — after the functional work.
- More squad/market rules.

## Latest owner requests (Sep 26, night) — ALL REQUIRED
- **End reset-on-join**: new/joining accounts must NOT be reset to 5k. `features.resetEpoch` must only apply once per deliberate owner "Reset everyone" click (never to accounts created after it). [A]
- **Global config / broadcasts / giveaways** only work on the owner's own client → must reach EVERY player (server RPC + client polling at startup + every ~60 s; banner for broadcasts; gifts inbox for individual + global giveaways). Prove with two browser profiles. [A]
- **Login UI**: wire `accountui.js` + `social.js` into the menus (sign up / log in / sign out / change username), `3d/css/account.css`; same UT club on every device. [A]
- **Owner Access** (renamed from Super Admin) must visibly do MORE than the full code; Vercel shows old abilities → make sure the new admin panel is what actually loads for both codes.
- **Card creator**: unlimited PlayStyles (+/plus), adjustable main + alt positions, choose ANY promo (no 4 limit), PNG upload, rating up to 999 for Owner Access; created cards can be **gifted** to any player (tradable). Gift button easy to find. [C]
- Moderation search must find any player (by name/username); "All players" list with usernames. Single "Add coins" button (no local vs online confusion). "Reset everyone" button. [C + A server]
- **Chemistry styles**: option between classic line chemistry and **FC26 chemistry** (no adjacency: club/league/nation counts across the XI, 0–3 per player, 33 max). [C]
- **Pack opening redo** (like owner's reference videos): pack **rips from the top**, card slides out hidden, FUT walkout sequence (flag → position → club → card) for high rated; no random 3D model right after opening; any 3D model must be realistic + smooth. Keep the old version revertible (setting/flag). [D]
- **Receiving passes (FIFA)**: after you pass, the receiver is mostly AI-driven to meet the ball, user input only nudges slightly, until he receives it. 3D [G] and 2D [F].

## Owner bug reports (Sep 26 night #2) — ALL REQUIRED
- [A2] Names still don't load (other players' names/usernames show wrong/blank in lists, market, friends, admin).
- [A2] Card creator: granting a created card doesn't work; sending/gifting cards doesn't work (must land in receiver's club, tradable). Stat sliders reset when you let go (touch/pointerup) — must keep value.
- [A2] Admin commands: give admin / revoke admin (per player), revoke ALL admin, change any player's username.
- [A2] Friends: add-friend must be in Settings and inside UT (no need to leave UT); friends list must work inside UT (invite/play/view squad).
- [A2] Test gifts: unclaimed global gifts could still be redeemed (coordinator expired them on the server Sep 27 00:45). Add admin "Cancel gift"/"Clear all pending gifts" + gift expiry picker.
- [A2] Coin counter count-up animation must run on EVERY coin change (match rewards, sales, gifts, SBCs, admin), not only in the admin panel.
- [A2] Switching local money <-> infinite glitches the game → one robust balance model; toggling must never corrupt/NaN/lose coins.
- [B2] Add LEAGUES to every player (real-style league names, fictional-safe) — SBCs/tournaments that ask for same league must be satisfiable; chemistry uses league.
- [B2] Ratings are bad: Neymar at 82 is wrong (should be ~91–93 peak/legend tier, top-3 of his generation). Re-check ALL top players. Bellingham must have LM + CDM alts (and CAM/CM). Generally sensible alt positions for all.
- [B2] PlayStyles: use the owner's "best PlayStyles+ per position" image (scratchpad/promorefs/playstyles_plus_by_position.jpg) — assign PlayStyles+ per position accordingly; card creator offers them too.
- [PROMO] Promo designs must apply to cards made in the card creator (choose promo → card renders in that promo design).

## Owner requests (Sep 27 morning) — ALL REQUIRED
### Owner/admin control panel [A2]
- Full list of EVERY player who ever signed in / played / made a team (no search needed), with all in-game info (username, club name, coins, rating/division, created, last seen, online, role, bans, device vs account).
- Open a player → see their team (squad + club + stats), control it: add/remove/delete their players/cards, edit any of their cards (tradability, rating, stats, promo, everything), add/remove coins (NO upper limit as long as nothing breaks), reset account / objectives / club.
- Ban completely, timeout (duration), ban from: using codes, activating admin, transfer market, packs; revoke access to features; message them directly (DM).
- Admins can list on the transfer market at ANY price (no min/max price rules for admins).
- Adding a big amount of coins glitches and doesn't credit → fix (safe integer handling, server limit raised, no NaN).
### UT UI [UI agent]
- PlayStyles (with PlayStyle+ icons) and alt positions must be visible in squad / club / card views.
- Card detail view: age, date of birth, nationality, club, league, height, weight, foot, PlayStyles, alt positions (goals for your club: later).
- SBC storage vault UI + "Send to transfer list" pile UI (core exists in meta/core — add screens/buttons).
- Real UI redo per docs/UI_DIRECTION.md (owner still says UI is not fixed).
### Players [small data agent]
- Flashback Neymar = 99.
- Add Egypt's full 2026 World Cup squad + best Egyptian players ever (icons/heroes), realistic ratings, leagues, PlayStyles.
### Economy [small agent]
- Swap system: swap players for coins, and swap players for TOKENS; tokens can be used to open packs (token pack store).
### 3D engine [G]
- Attributes must feel different (pace/acceleration/shot power/accuracy/dribbling/defending clearly change play).
- Admin cards must be absurdly OP: extremely fast, score from anywhere, win the ball from anywhere, never miss.

## Work order (owner allows 3 long agents + any number of small ones)
Done + live (Sep 26): A (login UI, reset-on-join fix, config/broadcast/gift propagation, migration 004), B (vault, promo gating, 3 new promos, dedupe, coin model), C round 1 (admin/card creator/Owner Access/chemistry styles/squad UI).
Running: C round 2 (menus, landing, 2D menus, account screens), D (pack opening redo), B2 (ratings, +500 players, admin cards, secret card, managers), small: 3D + 2D receive-pass assist.
Queue: PROMO CARDS (docs/PROMO_BRIEF.md: FUT-style card shapes + many promos, owner priority after UI), G (3D AI defending/marking/interceptions, Chromebook loading, faster stadiums, kits) after the 3D receive agent; F (2D AI defending, kits, 2D online) after the 2D receive agent; final UI polish.

## Paused 2026-09-28 (owner at 80% usage) — resume later
- Owner: "I still can't apply more than 3 positions" (alt positions capped at 3 — likely Card Creator / card editing; allow more).
- Unfinished, uncommitted in the working tree when paused: pack blank-stage fix + send-all buttons (packopen*.js), mobile pass + Moderation→Players merge + edit saved admin cards (hud.js, admin*.js, customcards.js, css), security hardening (net/accountcore.js, accountui.js, validate.js, CSP in index pages; migration 008 not written/applied), FUT Draft redesign + better odds + 7 subs (draft.js, modesview.js, draftpick.js, draft.css). All need finishing + testing before push.
- Owner: "allow me to create my own ban time even if its as small as a second" (custom ban/timeout duration, down to 1 s, in admin Players/moderation).
- Owner notes (2026-09-28):
  - Card Creator: name "pain man" keeps only the second word — keep the full name.
  - Gift box: add "Claim all".
  - Sending gifts on laptop says `needs_super` (works on phone).
  - Timed finishing only for penalties, not free kicks or anything else.
  - Online: FIFA-style animated opponent lineup reveal — GK, then defence, midfield, attack, then whole team.
  - Admin GK created in Card Creator saves as 65 with all stats 65.
  - Team shows old rating (96) instead of current (99).
  - Chromebook: "Couldn't download the 3D files" — Failed to fetch dynamically imported module https://s3.amazonaws.com/mathassets/.../fallback/index.js (game is running from an S3 mirror, not GitHub Pages; the mirror is missing module files — likely needs a single-file/bundled build).
  - Shooting 500+: every shot from any distance/angle/type (even weak) goes top bins and can't be saved; ball flight must look like a real powerful curling shot from the moment it's struck (no pass-looking shot that suddenly flies). Currently a 999-SHO card gets saved even from its own half.
  - Add more skill moves.
  - GK animations need a full revamp: keepers dive with their back to the ball, and dive diagonally/vertically/horizontally in odd ways. Want realistic side-on dives (facing the shooter), proper low/high/diagonal saves.
  - Add Power Shot and a proper Finesse shot; curved shots currently look bad.
- In progress (2026-09-28): "The Shawky" secret card: ∞ stats, Egypt, all positions + all PlayStyles, glitch-in-the-matrix design, teleport top-bins shots, acrobatic shot animations (bicycle kick etc.), instant perfect passes, penalties always in, long-range steals, can't be dispossessed. Egypt flag: add the gold eagle. Admin Vault pack (admin panel only, 50 players, 0.5% Shawky) with a green 0/1 matrix button. Small themed designs for every pack button.
- Unfinished work saved on branch `wip/paused-work`: packs Chromebook fix + send-all buttons, admin Players/Moderation merge + Card Creator bugs + edit saved cards + custom ban time, FUT Draft redesign + odds + subs, mobile pass, security (migration 008 drafted, not applied).
- Hosting: GitHub Pages, Render (pitchside-xl8m.onrender.com, auto-updates), Replit (manual copy, doesn't auto-update).
- Owner access bug: every time the owner joins, opening Owner commands → owner-only tasks says they're only an admin (outside it shows Owner), and they must re-enter the code every session. Owner level should persist and be recognized inside the owner panel.
- Owner (2026-09-28, later): Admin Vault pack = **10** random players per opening (not 5 top-rated, not 50), 0.5% Shawky.
- Owner: more versions of The Shawky card (same ∞ glitch card, own name + nation): Kilner (Scotland), Collins (South Korea), Patel (India), Oelke (Germany), BraydenMasilang (Philippines), Nickerson (Kenya), Dammad (Palestine).
- Owner: start/finish ALL paused work on `wip/paused-work` (see list above).
- DONE 2026-09-28 (on claude/compassionate-gates-n9kfni): Shawky WIP tested (all 403 tests pass, walkout/∞/Egypt eagle checked in browser); Admin Vault = 10 random players; 7 extra Secret card versions + nations IND/PHI/KEN/PLE; pack tile name overlap fixed.
- DONE 2026-09-29: `wip/paused-work` merged + tested (all 410 tests; browser: Card Creator, Draft desktop/phone, phone HUD, CSP pages). Includes: Draft redesign + 7 subs + better odds, Card Creator (full names like "pain man", GK stats no longer 65, up to 8 alt positions, edit/duplicate saved cards), Players/Moderation merged, ban length down to 1 second, mobile HUD, stricter password rules, CSP.
- Security migration 008 is PARKED in `supabase/drafts/pitchside_008_security.sql` (owner's choice). Not applied. Apply later in its own session (move back to migrations/, apply, rename to Supabase's version).
- STILL TO DO (owner notes above, not in paused work): gift "Claim all"; `needs_super` when gifting on laptop; timed finishing only for penalties; online lineup reveal; team shows old rating (96 vs 99); 500+ shooting always top bins; more skill moves; GK dive revamp; Power/Finesse shots; owner level not remembered in owner panel.
- Owner (2026-09-29): work on everything in the "what next" list: owner level remembered, `needs_super` on laptop gifts, team old rating, gift "Claim all", Shawky odds (8 secret versions share one slot), GK dive revamp, Power/Finesse shots + curve, 500+ shooting top bins, more skill moves; plus bug-hunt by playtesting and add animations/polish so it feels like a real, high-effort game (respect the 20 "vibecoded" rules).
- Owner (2026-09-29): add a NEW UI design the player can switch to in Settings; keep the current UI as an option.
- Owner (2026-09-29): use the ui-ux-pro-max skill for the redesign. Owner's reference videos: (1) skeleton loaders, one-hue (monochromatic) palette, clear title/detail hierarchy; (2) "5 AI tells": no gradients (one flat accent), number is the hero (no icon tiles), one primary + secondary sizes, shadows only on floating things, real numbers not "Welcome back" filler. Sent to the UI agent.
- DONE 2026-09-29 (owner said yes): (a) owner ACCOUNT = Owner Access (migration 009 applied; fixes re-entering the code + laptop `needs_super`); (b) gift "Claim all" (packs go to My Packs, one summary toast); (c) old 96 rating: owner confirmed it's gone (2026-09-29).
- DONE 2026-09-29: new 'Stadium' interface style (Settings > General > Interface style), Classic stays default. Not yet restyled beyond colours/fonts: Career, Draft, gifts, admin/owner panels.
- 2026-09-29: installed /brag + /brag-slim skills (launch videos) into .claude/skills/ (from latent-spaces/brag, MIT; music/sfx assets left out, license unverified).
- Owner (2026-09-29): multiple UT squads you can switch between; settings for 'Auto-build best squad' (what to prioritise etc.).
- DONE 2026-09-29: multiple squads (up to 5, switch/new/rename/delete on the Squad screen) + Auto-build settings (priority rating/balanced/chemistry, keep or best formation, use untradeables, fill empty spots only).
- DONE 2026-09-29: online lineup reveal (GK, defence, midfield, attack, full XI; skippable); Stadium style for Career/Draft/Gifts/Admin/Owner/Card Creator; ~109 em dashes removed from UI copy; free-kick hint no longer mentions the ring.
- TODO (net/, needs OK): ~15 em dashes left in `3d/js/net/online.js`, `services.js`, `transport.js` UI strings. Possible `renderLobby` TypeError on the guest side of a friend-code lobby (seen twice in mock two-tab tests, not reproduced reliably). Lineup reveals on the two devices aren't synced (would need a net/ change).
- Owner (2026-09-29): lineup reveal should show the real cards (design, attributes, rating) per line first, then the names+ratings pitch view. Auto-build filters: promo/card type, rarity, OVR min/max, build by league / club / country.
- DONE 2026-09-29: lineup reveal shows full UT cards (design, rating, attributes) per line, then the names+ratings pitch; auto-build filters (card type/promo, tier, rarity, min/max OVR, league, club, country; gaps filled from the club with a warning).
- DONE 2026-09-29: lineup reveal also before matches vs the AI (Kick-Off, UT modes); not in Practice or local 2-player.
- Owner (2026-09-29): GK AI: keepers don't come off their line to claim balls (sweeper keeper / crosses / through balls), and in 1v1s they just watch: should rush out, narrow the angle, spread, dive at feet / smother and win the ball.
- DONE 2026-09-29: in-match admin menu was never wired into the engine; now opens in every match for owner/mod (key ` or \, crown on touch), 29 effects, pauses offline, restyled (no purple gradient). Online: works when you HOST; a guest admin sees 'only works when you host' (guest relay needs a net/ change).
- DONE 2026-09-29: keeper AI (sweeper claims, cross catch/punch by handling, real 1v1s: narrow angle, set, smother lunge; win ~40% / rounded ~30% / touch ~20% / pen ~8% vs avg keeper). Goals per match about the same.
- DONE 2026-09-29: secret card 'Grumpy Patel' (India, owner's photo cut out, 3d/assets/cards/grumpy-patel.webp, own 0.05% / 0.5% chance); long card names shrink to fit instead of '...'.

## Sep 29 (owner)
- DONE: every promo pack on sale in the Store from week 39 (`ALL_PACKS_ON_SALE_FROM` in promos.js); Admin Vault stays out.
- DONE: Manuel Neuer gets three 99 cards (Flashback, Moments, Fiesta).
- DONE: admin Global Config tab has a "Store packs" list: tick/untick any pack (not Admin Vault) for everyone (server config `packs.<id>.enabled`).
- DONE: Secret Vault secret-card chance 0.1% per card (was 0.05%). Owner said "0.1"; if they meant 10%, change SECRET_ODDS.
- DONE (Sep 29): secret card "AryeetyMensah" (owner's photo, top label "THE NII"): anti-admin card, all stats shown as -inf; in matches he barely moves, his passes go to the opponent, he loses the ball instantly, and any shot he takes goes in his own goal and counts as 10 own goals. (secretcard.js `cursed`, sim.js `_cursePlan`/`_curseFumble`, tests in engine/tests/cursed.test.mjs; nation set to Ghana, owner can change.)
- DONE (Sep 29): gifts find players by club/display name in any capitals (e.g. "oelke fc"), not just exact usernames.
- DONE (Sep 29): owner panel Players rows have a Card button (send any card, like Coins).
- DONE (Sep 29): Oelke secret card uses the owner's photo, cut out (3d/assets/cards/oelke.webp).
- DONE (Sep 29): 15 more "elite-" Evolutions (evolutions.js) that accept cards rated up to 98, promos included.
- DONE (Sep 29): owner can delete any account or guest (Delete on each Players row) and bulk "Delete old guests" (N days idle, 0 = all). Migration 010 applied as 20260929133106. Never the owner account itself.
- DONE (Sep 29): Klose (late Icon, realplayers.js LATE_ICON_ROWS, kept out of ICON_ROWS so seeded promos do not move) and Muller have 5 cards each, two at 99. Verified no existing card id changed.
- DONE (Sep 29): Manage (Admin > Players) crashed with "DURATIONS is not defined" (restriction rows); now uses the number+unit picker, and the screen shows an error instead of going blank.
- DONE (Sep 29): 6 evolutions are 'instant' (no matches, claim right away): Rising Star, Pace Merchant, The Wall, Street Magic, Captain's Armband, Last Line (GK).
- DONE (Sep 29): Store showcase carousel (utview.js packShowcase): cycles every pack every 3.5 s, swipe / arrows / arrow keys, hold to zoom, pauses on hover or hold, off under reduced motion.
- DONE (Sep 29): UT home Store tile shows a fan of packs (like the Squad tile) that turns every 3 s; subtitle follows the front pack.
- DONE (Sep 29): Nickerson secret card uses the owner's photo, cut out (3d/assets/cards/nickerson.webp).
- DONE (Sep 29): Evil Nickerson secret card (-∞ stats, cursed, EVIL tag, Kenya).
- DONE (Sep 29): Perlita + Evil Perlita secret cards (∞ powers; evil = red design, EVIL on top; nation Kenya).
- DONE (Sep 29): Evil Perlita has -∞ stats (cursed like THE NII). Evil Nickerson will be the same once the image is re-sent.
- DONE (Sep 29): owner badge (Stadium) now a chamfered dark button like its neighbours, accent only on the crown + left edge.
- DONE (Sep 29): Settings > UI colour: 10 swatches (theme default + 9), css/accent.css, applied before first paint by uistyle.js.
- DONE (Sep 29): Club and Swaps lag fixed: cards build 48 at a time as you scroll (dom.js lazyFill), Set lookups, debounced search. 1150-card club: 3.7 s -> 0.35 s.
- DONE (Sep 29): custom colour picker (last swatch opens the browser colour picker; js/uiprefs.js, --user-acc vars).
- DONE (Sep 29): gear button in the UT header opens Display (interface style + UI colour).
- DONE (Sep 29): admin tab "Open N at once" (1-10): all packs roll together into one reveal, best card first (openPackFlow count).
- DONE (Sep 29): E-Man (∞) and E.L.I.J.A.H. FINAL FORM (???^∞) secret cards: Admin Vault only (adminOnly), full fire art (art-fire). Nation guessed GHA.
- DONE (Sep 29): card stats centred; names size by letter width (4 steps, xs-aware) so none of the 4,016 cards clip at sm or xs; secret cards say ANY POSITION instead of a clipped list; UT screens toured in both styles on desktop + phone. Knight card renamed Rabbi Patel; E-Man / E.L.I.J.A.H. from Israel.
- DONE (Sep 29): forced pack pulls: admin tab 'Force pack pulls' (your queue, up to 10) and Players > Manage 'Force a pack pull' (owner patch op forcePull, migration recorded as 20260929200215 pitchside_011_force_pull).
- DONE (Sep 29): EVIL VINSON HELL card + timed curse, spinning planet, account ban/owner release, squad/pack/match consequences in `chatgpt/hell-card`. Migration 011 is applied; details: `docs/VINSON_HANDOFF.md`.
- DONE (Sep 29): Rabbi Patel goal celebration (engine/ui/goalcard.js FLAG_GOAL_IDS): Israeli flag, spinning Star of David, star zooms through its hexagon as the exit (~4.5 s).
- DONE (Sep 29): Pain Man angelic secret card: halo baked into the cut-out photo, white-and-gold design (is-angel), ANGELIC on top, |∞| stats. Nation guessed EGY.
- DONE (Sep 29): Saved cards (Club tab): duplicates left on a pack's Done go there instead of being quick-sold; a pack left mid-opening (tab closed / reload) is rescued there on next load (ut.js pendingPack / rescuePendingPack).
- DONE (Sep 29): test link ?test=1 (3d/js/testmode.js): in-memory storage, fake online server, Owner Access, banner; reload = clean slate. See HANDOFF section 7.
- DONE (Sep 29): owner rule: ignore Render and Vercel (CLAUDE.md + HANDOFF updated).
- DONE (Sep 29): Codex pack-opening visuals (codex/pack-opening-visuals) were already merged as the "Classic" pack animation; the test link now starts on Classic (toggle on the pack screen switches to New).
- DONE (Sep 29): ∞ sign lopsided on Chromebooks (one loop bigger): every ∞ in the UI is now a drawn symmetric sign (dom.js infHtml/infNodes, .ps-inf in meta.css).
- DONE (Sep 29): squad picker hides players already in the XI/bench (and other versions of them); panel is taller; each row shows flag + nation + the six stats.
- DONE (Sep 29): admin commands near-instant: presence heartbeat 25 s -> 3 s (PRESENCE_MS, server throttle 3600/h, migration 016); Store/UT home redraw when the config changes; owner DMs pop up (Message from X) next to announcements; message box restyled (plain dark panel); Store packs Add all / Remove all; Send card modal has "Add to club" (owner patch, straight into their club) next to Gift.
- DONE (Sep 29): checked Vinson lift + unban: both work server-side (one player lifted OK).
- DONE (Sep 29): owner panel: Vinson-cursed players show first in blood red (Vinson ban/curse tag); 'Lift Vinson curse' only on cursed players (migration 017 adds vinsonPhase to admin_players).
- DONE (Sep 29): Settings > "Starting XI at the end": Shirts | Cards | Cards (vertical) (lineupreveal.js finalView; cards hold ~3 s). Owner is sending a video of another bug.
- DONE (Sep 30): (1) online teams now carry each card's display view + admin/secret tiers (protocol.js cleanCardView; rawOvr/glitch/cursed were being stripped online), reveal draws the real card, XI shows 999/∞, phone title fits; (2) in-match admin: visible ADMIN button on every device + "Admin effects" in the pause menu; (3) lag: realtime msgs dropped while a data channel is backlogged (PeerJS 'rt' channel was reliable, up to 8 MB queue) + presence 15 s during matches; (5) owner writes send a Supabase Realtime poke (relay.js openPokes) so the player checks in at once; poll 8 s when pokes live, 3 s fallback.
- DONE (Sep 30): (4) in-match Team management redesigned (engine/ui/hud.js _menuTeam): real UT cards on a pitch at their formation slots, bench as cards, stamina + match rating, tap to sub/swap, Formation chips + Mentality, Tactics as segmented controls, Set pieces with the taker's card; pause menu recoloured charcoal (no navy/blue gradient). PRODUCT.md added (design skill context).
- TODO: guest-side in-match admin (a guest admin's commands relayed to the host) still not supported; only the host can use admin effects online.
- TODO (Sep 30, owner video IMG_5651): (a) Squad screen: player stats not visible; (b) real human managers, packable; (c) HARD: more real players + a real photo per real player (web, not AI art); icons in monochrome like FIFA; some icons wrongly show as gold cards; (d) re-evaluate ratings: legends/99s, packs far too generous (99s too easy); (e) promos: dynamic images, more diverse players per promo; (f) secret cards always sort on top everywhere; 999 must never rank above ∞; (g) Store sections: Manager packs, Promo packs, Normal packs.
- DONE (Sep 30): (a) Squad pitch shows full cards with the six stats; (b) 24 real managers, packable (Store > Managers, Manager Pack 40k, dup refund 10k; state.managers; assign in the Squad manager slot; chemistry by nation/league); (d) pack draws weighted by rating inside each category (ut.js pickByRating, RATING_DECAY 0.6): 99s now ~0.03–0.07% per pack; (e) promo campaigns prefer least-used people (227 -> 285 people); old promo ids still resolve (players.js legacy resolver); (f) Secret cards always first in every list (core/rank.js), ∞ above 999; (g) Store sections: Normal packs / Promo packs / Managers.
- DONE (Sep 30): agent branch merged: photo pipeline (tools/fetch_player_photos.py + faster tools/fetch_photos_wp.py via en.wikipedia batch API, free licences only, credits.json + 3d/credits.html), photo card styling, Icons monochrome, CLASSIC legends use the Icon design, 121 more real players (realregulars.js LATE_REG_ROWS, ids rp_*). Manager photos 24/24.
- DONE (Sep 30): Legend of the Game is elite: current real players below 88 are plain rare golds (realplayers.js LOTG_MIN_OVR); Pelé + Maradona 99. Old Flashback ids still resolve via the legacy promo build.
- IN PROGRESS: bulk player photo download (fetch_photos_wp.py), then commit webp files + credits + playerphotos.js.
- DONE (Sep 30): Rabbi Patel celebration: star spins 2.6 s/turn (was 1.1), owner's 3 photos left/top/bottom (assets/celebration; the fabricated kiss image was declined, right side left empty). -∞ cursed cards: no instant giveaway (_curseFumble removed), slow but mobile (vmax x0.3), tackles/contests on them ~8% as effective; shots still own goals worth 10.
- TODO (Sep 30): photos v2: base cards = FIFA-style face crop with background removed (face-detected, no foreheads), wrong-era photos rejected (old retired legends, childhood photos); monochrome only for retired Icons (Messi/Ronaldo etc. still play, keep colour); promo cards = dynamic look (bigger cutout like FUT TOTS).

- Sep 30: Photos v2 (FIFA face cutouts, dynamic promo cutouts, colour for active icons) PAUSED by owner at ~300/807 to save usage. Live photos reverted to before v2. Saved state is on branch wip/paused-work (resume: tools/photos_v2.py --no-download, then tools/write_photos_js.py).
  - How to resume photos (fresh chat): `git checkout wip/paused-work -- tools/photos_v2.py tools/write_photos_js.py tools/fetch_player_photos.py 3d/assets/players 3d/js/meta/core/promos.js 3d/js/meta/ui/card.js 3d/css/meta.css 3d/index.html 3d/js/meta/core/realplayers.js`,
    `pip install "opencv-python-headless<5" rembg`, then `python3 tools/photos_v2.py --no-download` (uses cached sources, ~30 min for all 807;
    try `--limit 20` first), then `cd tools && python3 write_photos_js.py`. Rules: base = FIFA face cutout, no background; promos = bigger
    "dyn" cutout; monochrome only for retired Icons; reject photos where the player is under 17 / past their playing years or the crop is bad.
    Full download pass (no --no-download) is slow: Wikimedia rate limits.
- Sep 30: Saved cards "Claim all" (non-duplicates to club) and "Sell all" (quick sell, Secret cards kept). DONE.
- Sep 30: Remove all username restrictions (any characters, 1-16, no word filter; uniqueness + reserved owner name kept). Migration 018.
- LATER (owner, Sep 30): accounts/progress: signing out in one tab still showed the Shawky FC cards (save is per browser/device, not per
  account), and the game treats "Shawky FC" and "Phonk Mode FC" as different clubs. Merge those two into one (Shawky FC = the name after login),
  and make sign-out / a second account in another tab not share the same local club.
  Clarified: "Shawky FC" is the ACCOUNT name, "Phonk Mode FC" is the UT CLUB name of that same account (not two people). Link them as one.

- DONE (Sep 30, branch chatgpt/fifa23-promos; awaiting Claude merge): all 26 requested FIFA 23 campaigns, real display names with existing saved IDs retained, local design keys, generated packs/SBCs, 115 new deterministic promo cards and diversity regression coverage. Card renderer, CSS and network untouched. TOTS Warm-Up / Pre-Season reuse TOTS / FUTTIES backgrounds.
  - Merge handoff: `design` is campaign metadata for Claude's card renderer integration; this branch does not change card.js/meta.css. Existing launch weeks preserved; nine new campaigns fill unused future weeks. Validate with `node 3d/js/meta/tests/promos-fifa23.test.mjs` as well as the standing suite.
- Sep 30 (owner, late): promo cards must be the REAL EA cards (real rating/stats/picture/design per card), not boosted
  copies; store section per game (FIFA 22, 23, FC 24-27); secret cards stay unique (custom art, not reused EA designs);
  no picture outside the card; no photo backgrounds unless the real FIFA card has one; no shared celebration picture
  across promos. SECRET CARDS: owner says leave them alone (own category). Split with ChatGPT in docs/AI_DIRECT.md (group chat). Real FC 26/27 promo items: Claude agent 3.
- Sep 30 night (owner): secret cards get their OWN custom designs inspired by the card/pack (angelic, demonic, glitch /
  binary code 0101...), reactive + animated. Do NOT touch Rabbi Patel, E-Man, E.L.I.J.A.H. (and any card designed from
  an owner picture: Rabbi Patel is Israeli-themed, Elijah and E-Man are fiery). Vinson can get a rework; the green glitch
  secret cards get a rework; Pain Man stays or gets a slight rework.
- Oct 1 (owner): owner panel "Delete player", "Reset coins/progress/club/account" and other commands don't work;
  "remove card from club" sometimes fails. Root cause found: the server does the reset, but the player's client never
  applies per-player reset epochs and re-uploads its local save (same for deleted accounts). Claude agent fixing (client
  + new migration 019). Vinson lift bug (effects stay after unban): fixed on chatgpt/vinson-unban-recovery, awaiting Claude review/merge.
- DONE on branch (Sep 30, owner): Vinson unban restores ordinary controls while preserving squad curse side effects;
  Lift curse remains visible for released players and remote lifts reach freed clients. Actual pack/control artwork
  now fractures into irregular fragments instead of caption boxes or replacement pictures. All 22 suites pass;
  browser visual review remains pending. Handoff in docs/AI_DIRECT.md.

- PENDING / PAUSED (Sep 30, owner): Vinson starting-XI lock/X chains, longer aftermath pack exit, stronger doom visuals,
  and a playable cinematic Fight Suppression encounter with Patel / World-Ruler Vinson / Phonk Mode Vinson / Captain Israel,
  unique victory reward cards and permanent account curse immunity. Await owner go-ahead and verified assets.
  Planning/help/skills request posted to Claude in docs/AI_DIRECT.md on chatgpt/vinson-battle-planning; no code changed.

- Sep 30 (owner): Vinson pull can lag/stick on Send to club; mods sometimes miss the curse animation; quick selling
  must never prevent the curse. Fixed on chatgpt/vinson-pack-guard: register the curse as soon as the pack rolls
  Vinson, keep the original pack controls usable so assignment/Close completes, retain the saved curse on RPC failure.
  Quick selling/resolving does not clear the curse; mods remain affected and only owner is exempt.
- Oct 1 (owner, LATER): Icons in promos must get their OWN Icon version of each promo (EA style: unique red-and-gold /
  Icon variant designs), never the normal promo design; base Icons never look silver or gold.

- IN PROGRESS (Sep 30, owner go-ahead): Vinson animations / Fight Suppression on chatgpt/vinson-animation.
  Scope: existing Doom/aftermath/chains, playable two-stage cinematic battle, isolated reward cards; Claude asked
  for server battle nonce/win/immunity/idempotent claim support in AI_DIRECT.
- Sep 30 (owner): Vinson pull can lag/stick on Send to club; mods sometimes miss the curse animation; quick selling
  must never prevent the curse. Fixed on chatgpt/vinson-pack-guard: register the curse as soon as the pack rolls
  Vinson, keep the original pack controls usable so assignment/Close completes, retain the saved curse on RPC failure.
  Quick selling/resolving does not clear the curse; mods remain affected and only owner is exempt.

- CHECKPOINT Sep 30, chatgpt/vinson-animation: existing Vinson effects/X-chains/XI lock/10s pack exit and playable
  two-stage battle/cinematics are implemented. Win/immunity/rewards integrate with Claude's live migration-020 server APIs.
  Full live-account/browser review remains pending; isolated preview: 3d/vinson-battle-test.html.
- URGENT Sep 30, PR11: roll-time curse started before pack Open; move trigger to first post-opening grid render.

- URGENT Sep 30: Vinson roll-time curse activation interrupted pack opening. chatgpt/vinson-reveal-fix moves it
  to the first actual post-opening item-grid render, preserving quick-sell protection and the original timer.

- READY FOR BROWSER GATE Sep 30, PR12: live battle API connected; status-before-start clears cached unban,
  retries replace nonce, too-soon confirmation is recoverable, and interrupted local reward saves reconcile without
  duplicates. Claude owns the final curse/unban/lock/fight/win/claim/reload browser review before merging.
- DONE (Oct 1): Vinson-banned players can fight from the ban screen (migration 021; moderation bans still blocked).
- DONE (Oct 1): Kilner, Masilang and The Shawky secret cards use the owner's photos (cut out, sharpened); originals in tools/photo_sources/.
- DONE (Oct 1): merged ChatGPT PR13 (doom after pack closes), PR14 (ban-screen fight + zero-coin consequence), PR15 (six-punch pack collapse); browser-checked.
- DONE (Oct 1): merged ChatGPT PR16 (Doom breaks one clicked control at a time; Home tab stays usable).

## Vinson visual review follow-up (Sep 30, review ready)
- chatgpt/vinson-visual-review: asymmetric punched hole, shaded articulated reaching hand, larger framed boss
  portraits and visible Phonk matte. Tests and native frame inspection passed; Claude browser review/merge pending.
- DONE (Oct 1): merged ChatGPT visual review (jagged punch hole, shaded hand, Vinson full size in fight).
- DONE (Oct 1) Testing mode in the real game (?livetest=1): logs out to a fresh guest, separate local save (real club untouched), still online so admin commands from the owner account work on it.
- DONE (Oct 1) Interface style "Stadium" as the default (old saves switch once; Classic stays only if picked in Settings).
- (Oct 1) Vinson bugs from owner testing: doom no longer breaks packs/coins on packs etc., Squad tab still works during doom; Fight Suppression button does nothing; curse aftermath fully broken (no buttons breaking, packs don't give Vinson). ChatGPT fixing; Claude reviews to find the cause.
- DONE (Oct 1): Doom breakage restored for home tiles (Squad tile etc.), packs, store items, coins and crest (PR16 had dropped them). Fight Suppression verified working against the real server.
- DONE (Oct 1): Fast device sync: local changes upload within ~3-15 s, other devices of the account get a poke and also check the cloud revision every 15 s / on tab focus (migration 022 pitchside_save_rev), downloading only when changed and nothing local is pending.
- DONE (Oct 1): Tabs of one browser: another tab's club change reloads the club here; signing in/out in another tab reloads this tab (not during a match). Owner's server club was intact (1920 cards).
- DONE (Oct 1): owner unban now puts an owned Vinson into the XI so the aftermath (5 s + 10 s warnings, lock, all-Vinson packs, match consequence) always runs. Live test banner shows the build number.

## Vinson video review / boss redesign (Sep 30 night, review ready)
Owner videos show grouped Doom pack-panel damage and ordinary post-unban pack rewards. On
chatgpt/vinson-gameplay-review: restore individual targets + explicit locked aftermath, source-picture combat,
four star/eye attack choices, moving harder boss, gameplay dialogue/optional speech and original story stages.
Node suites and native rendered frames pass; Claude live desktop/mobile account-flow review/merge pending.
Supersedes PR18. Existing source photos, server fight/rewards and cross-device sync preserved.
- DONE (Oct 1): merged ChatGPT PR19 (Doom hits only the clicked leaf, locked aftermath breaks controls, all-Vinson zero-coin packs, fight rework with 4 attacks); browser-checked.
- (Oct 1, owner) Claude's standing role: critic / game tester. Watch AI_DIRECT + ChatGPT branches; for every push: define what
  should happen, test it (suites + real browser, desktop and phone), critique (bugs, feel, visuals, the 20 "vibecoded" tells),
  post concrete findings with screenshots/steps in AI_DIRECT, merge only what passes.
- (Oct 1, owner) Critiques must also say what to make BETTER (cooler, functional, aesthetic), not only bugs. Direction brief for the fight posted in AI_DIRECT (hit tiers, telegraph grammar, dodge/perfect dodge, camera, arena, UI).
- (Oct 1, owner) Ending: sword digs deeper; laser clash interactive (mash to win, then ending runs on its own); domain clash way cooler. Sent to ChatGPT in AI_DIRECT.
- (Oct 1, owner) Vinson gets a demonic star sigil on the ground (like Captain's), domain made cooler. Sent to ChatGPT.
- DONE (Oct 1, owner): merged fight prototype 13 into the live game (cinematic fight, 6 abilities, 20% gates, memorial ending). Next prototype: mash-to-win clash, deeper sword, cooler domains + Vinson demonic sigil, feel brief A/C/F.
- DONE (Oct 1): Squad tile Doom lag fixed (fracture copies big targets shallow: 2.3 s freeze -> 0). "Keeps refreshing": not reproducible with one person per account; device-sync downloads now update the club in place (no screen jump), wait until the player is idle and out of matches/packs/dialogs, and toast at most once a minute.
- DONE (Oct 1, owner): dodge box hit flash now appears on the player (was 65 px above), radial pattern hint now marks the real escape gap (was the box centre).
- DONE (Oct 1, owner): Prototype 1-Claude built (3d/prototypes/claude-01): rune lock + inverted controls, heal economy, slam -> black hole, chains + 3-key escape, random ECLIPSE BREAKER finisher (2x heavy), fixed box hints, feel/VFX brief. Stand-in characters, no dialogue.
- DONE (Oct 1, owner): Prototype 2-Claude (3d/prototypes/claude-02): ChatGPT's features + mine, 2 phases with both fighters transforming, beam clash + domain clash (mash to win), secret TOTALITY phase 3 (finisher kill while the eclipse aligns) with its own look, clash, true ending, better rewards; synth sound. Self-score 8.6. Waiting: owner's extra ChatGPT instructions to fold in.
- (Oct 2, owner) Sent Claude every ChatGPT instruction; finisher = 7 keys in order.
- DONE (Oct 2): Prototype 3-Claude (3d/prototypes/claude-03): 7-key finisher, miss chance, distinct form-2/3 specials, much harder boxes (sweep/crusher/rain/bouncers), hand barrage, combos, bigger field + smaller hero, clash sway + sword throw, cinematic clickable dialogue (placeholder lines), six-point-sigil + sky-light return, sunset meadow ending (shield planted, sword falls and digs in), music. P1/P2 kept.
- DONE (Oct 2): live fight uses a cut-out Captain Israel image (white background removed).
- (Oct 2, owner) Phase 2 also ends on a beam clash like the first; from ChatGPT's 13 take only the struggling + pushing dialogue, otherwise make the finale look like 14. Give feedback on 14.
- DONE (Oct 2): critique of ChatGPT 14 in AI_DIRECT (7.9/10: finale 8-12 fps, ending composition, chains prompt). Prototype 4-Claude built with the owner's clash/finale changes.
- DONE (Oct 2, owner): P4 ending: sword now lands right beside the shield (was ~330 px away).
- DONE (Oct 2, owner): P4 meadow keepsakes placed like ChatGPT 14 (no grass over the shield; sword falls with gravity + lean, lands tip-first half-buried beside the shield, wobble, crater, dirt kick); my art kept.
- DONE (Oct 2, owner: keep improving + borrow from ChatGPT): Prototype 5-Claude: +2 HP perfect dodge, seam star, curved domain wall, meadow rays/haze/flowers, memorial light, boss wind-up/recoil/slump, foreground rubble.
- DONE (Oct 2, owner): P5: shield deeper; stop-and-read dialogue restored (pre-clash scene + 2 paused beats per clash struggle); dodge box made much harder (ChatGPT-style aimed fans from box 1, shorter previews, faster). Full critique of ChatGPT 15 + skills list posted in AI_DIRECT.
- DONE (Oct 2, owner): merged ChatGPT prototype 15 into the live game (versions bumped; all suites pass).
- (Oct 2) Reviewed ChatGPT hud-15 (8.4/10, FPS solved, chains prompt regression); copied 8 skills to docs/skills-for-chatgpt for ChatGPT. Not merged yet (waiting on the chains fix).
- DONE (Oct 2, owner: merge anyway): ChatGPT hud-15 merged live (chains-prompt overlap bug is live; ChatGPT told to fix first).
- DONE (Oct 2, owner): self-rated P5 7.9 on the same scale as ChatGPT; built Prototype 6-Claude (clash key moments, UI pass, readability).
- (Oct 2, owner) Fix and improve everything until 9/10; add a HARD mode (extremely hard but beatable) + rate difficulty. Owner's notes: clash needs more key sequences and a much stronger boss; box had too much going on (wanted the blue safe spot fixed); she barely uses the box; current build = NORMAL.
- DONE (Oct 2): Prototype 7-Claude (3d/prototypes/claude-07): Normal/Hard picker, stronger clash with 3/4 key moments + loss/retry, persistent blue SAFE spot, clean Normal box, box as a regular attack, Hard harder in everything; art/UI/phone polish. Self-rated 9.0. Difficulty: Normal 6/10, Hard 9/10.
- (Oct 2, owner, with screen recording) Every hero ability must contain a Star of David: STAR = thrown spinning star; SPIN = 3 stars with slight homing; BURST = big spinning star, explodes on impact with a star-shaped blast; EYES = laser carrying a star, with an impact reaction; SIXFOLD = stars fall from the sky and explode (animated); NOVA = huge spinning star, the coolest animation and a unique explosion. Form 2/3 movesets also heavily Star-of-David themed. Playing field is way too small; leave space to click dialogue. Undertale box still extremely easy: make it even harder than the recording, with FEWER indicators (distracting). Owner will send Undertale fight references (fights only). Keep improving everything.
- DONE (Oct 2): Prototype 8-Claude (3d/prototypes/claude-08): Star of David moveset for all 18 moves (projectiles, icons, a unique star explosion per move, NOVA the biggest), box 700x350 with her line in a strip below, new gap-wall/ring/spiral patterns, only the blue safe area kept as an indicator, harder in both modes. Owner's live-game notes passed to ChatGPT in AI_DIRECT. Waiting: owner's Undertale fight references.
- (Oct 2, owner) Sent Undertale fight videos (Napstablook, Toriel, Papyrus, Mad Dummy, Muffet; more coming). Some are extremely easy: NORMAL must be hard, HARD harder than hard.
- (Oct 2, owner) Also sent Asgore, Undyne, Mettaton fights ('that's enough inspiration'): doesn't need the same mechanics, just ways of throwing projectiles, but open to Undertale mechanics; P9 tries them (blue/purple/green souls, bones, strings, turrets, spears, colour sweeps).
- DONE (Oct 2): Prototype 9-Claude (3d/prototypes/claude-09): Undertale-style box acts (blue gravity bones, purple strings + spiders, Mad Dummy turrets + homing missiles, green shield vs Undyne spears, Asgore blue/orange sweeps + fire, plus my star patterns); box reshapes per act; Normal hard, Hard harder. Brief for ChatGPT in AI_DIRECT.
- (Oct 2, owner, sent the Israel flag) Fight field still small, can't reach top/bottom. Stars of David don't read (look like normal stars, too fast): use flag blue with white inside (hexagon + triangles) or make them invisible. Hit effects not dramatic enough. Polish the Undertale mechanics, they're hard to look at.
- DONE (Oct 2): Prototype 10-Claude: taller fight field (horizon 330 -> 212), flag-style Stars of David (blue bands, white inside, slower spin), 3-tier dramatic boss-hit effects, polished Undertale box visuals (white-on-black hazards, outlined bones, cleaner spiders/turrets/spears/fire, no red screen on box hits). Notes passed to ChatGPT.
- (Oct 2, owner) Inverted-controls warning catches him off guard (misclicks). Finisher(s) should be Star of David themed: hero traces every line of the star leaving a trail, then a beam of light from the sky, huge spinning star on the ground; several different finisher versions. Owner's name for it: a real politician's name (Claude keeps a neutral placeholder; the name is one line in script.js for the owner). Star of David white fill too strong: make it hollow. Timing bar too hard: marker should go back and forth.
- DONE (Oct 2): Prototype 11-Claude: rune GET READY + inversion countdown, hollow flag stars, timing marker goes back and forth, three Star of David finishers (trace + trail, spinning ground star, sky beam), finisher name in script.js, Hard ~2x attack rate + 3-attack combos + constant hand spray. Notes for ChatGPT posted.
- (Oct 2, owner) Save phases: checkpoint at each phase (retry from it after a loss, continue later).
  DONE: phase checkpoints in P11 (save per mode, RETRY PHASE N after a loss, CONTINUE on the title; a clear wipes the save).
- (Oct 2) Vinson "doesn't work if pulled twice": by design a profile is cursed once (after an owner lift or a battle win, pull starts no new doom). Owner chose an owner-only RESET instead of changing the rule. DONE in client: owner panel "Reset Vinson" (list row + Manage), services/mock `vinson.reset`, client drops a finished local curse when the server has no record, net test added. PENDING: server migration `supabase/drafts/pitchside_023_vinson_reset.sql` is NOT applied (the Supabase MCP timed out on every write, likely waiting for an approval this session can't show). Apply it (Supabase SQL editor, or apply_migration with approval), then move it to supabase/migrations/ named with the recorded version.
- (Oct 2, owner) Apply the Vinson reset migration; merge latest ChatGPT work; P12: fights too easy (minigames hard, make harder; Undyne spears from several sides at once; leave bones as is); normal (non-box) fighting way more chaotic in both modes; boss HP x3 in Normal and Hard; new finisher version: builds a sukkah (Sukkot hut) and drops huge Star of David bombs.
- DONE (Oct 2): merged ChatGPT prototype 16 live (supersedes difficulty-15). P12-Claude: boss HP x3 both modes (+finisher x3), much more chaotic non-box fighting, multi-side spear volleys, harder strings/turrets/sweeps/star patterns (bones unchanged), 4th finisher SUKKAH with star bombs. Migration 023 still NOT applied (Supabase write tool times out on it).
- (Oct 2, owner) Heal during the mini games; read ChatGPT's latest box/mini-game code and ADD its mechanics (remove nothing); some mini games are genuinely impossible to finish without a hit: fix; rate everything then improve.
- (Oct 2, owner) "I don't see the sukkot finisher at all" + "the star of David bugs out sometimes".
- DONE (Oct 2) P13-Claude: heal (H) works inside the box; ChatGPT's box mechanics added as a new act (lanes / columns / radial ring with a gap / beams, dashed safe-zone preview, aimed fans); fairness fixes (bones one direction with reaction gaps, strings never close the last free lane, spears spaced and a flip only last, sweep fire never on the soul); bot hits on Hard at 0 latency: bones 306→121, strings 301→26, swipes 134→42. More box sounds. SUKKAH was only the 4th finisher in a fight: finishers now rotate across fights (saved) and a new player gets SUKKAH first (?fin=0..3 to pick). Star bug: homing stars could stall and shake on the boss after she dodged; they now turn at a capped rate, keep speed and stop homing once past her.
- (Oct 2, owner) New finisher "DAVID LASER": he teleports to each point of the star, all fire lasers at her at once making the sign; or the points fire at each other to draw the star, it spins up very fast and blows up. Then: "make them two different finishers".
- DONE (Oct 2) P13: two new finishers. DAVID LASER (blinks to the 6 points, six beams into her, the sign burns in and grows, blast). SPINNING STAR (blinks to the 6 points, beams across draw the star, spins up to a blur, blows up with flung stars). Six finishers now rotate across fights; a new save starts on DAVID LASER (?fin=0..5).
- (Oct 2, owner) Sukkah must be built AROUND the boss with a building animation, then the bombing; finisher names always showed "Star of David something".
- DONE (Oct 2) P13: SUKKAH rebuilt: he hammers 4 poles in round her (3 hits each), beams, walls unroll, throws 9 branches up for the roof, hangs fruit, leaps clear; 5 star bombs fall from the sky onto the hut, then a giant one blows it apart. Every finisher now shows its own name on the prompt, the key screen and the cinematic (STAR PATH, SIX POINTS, RISING STAR, SUKKAH, DAVID LASER, SPINNING STAR).
- (Oct 2, owner) "If any finishers look way too similar, make them unique." DONE: SIX POINTS → MAGEN DAVID (giant Star of David shield soaks up 8 of her shots, charges, he rams it into her: shock line + ground star wave). RISING STAR → STAR CAGE (the two triangles fly in from both sides, lock round her, crush in 3 squeezes with cracks, shatter into shards). All six now different: STAR PATH, MAGEN DAVID, STAR CAGE, SUKKAH, DAVID LASER, SPINNING STAR.
- (Oct 2, owner) Heal during everything (low in mini games); bones far too easy now: go back to the old bones but slightly easier; spears arrive at the same time (impossible); the gate run ("openings"): first gap impossible to reach, make it longer with gates that make sense.
- DONE (Oct 2) P13: H heals in the box, clash, counter bar, chains, rune lock and finisher keys; 2 heals per phase (was 1) and the SURVIVE bonus heal now comes at the START of the box. Bones: back to the P12 mix (both directions, doubles) ~9% slower spawn, plus one guard so two bones never need conflicting moves at once. Spears: arrivals spaced .42 s (Normal) / .34 s (Hard), was .24/.19. Gate run: 8 walls (9 Hard), first gap always reachable from where you are, each next gap within reach of the last, the act waits for the run and nothing new piles on until its end.
- (Oct 2, owner, "probably the last message") Rate everything and get every area to 9.5; no-damage glitch; bones even easier (never from the other side, always blue): make them really hard but doable; EXTREME mode (everything extremely hard + the boss summons minions you must kill before she can be damaged again); a different finisher set per phase + more Star of David finishers unlike the current ones; beam clash: 3 losses reset the whole level; 1 s GET READY before finisher keys (dyslexia); new boss attack: rows of red dots, spikes 1 s later, rows march edge→middle horizontally, then vertically, then rings outward; arrows slightly faster (spacing fine); rare 5% STAR OF HELL (Algol): red star + fire from the sky + blast, Algol-shaped laser, vertical laser, a star that spins 2 s exponentially faster and overcharges; 20% boss HP; red prompt; more keys, more time.
- DONE (Oct 2) P13 final: all of the above. Glitch = any dodge during ANY laser counted as a perfect dodge (no position check, whole laser length) → endless i-frames + heals; now only just before it fires and only if it would hit you, perfects have a 1.1 s cooldown, the dodge tail has no i-frames. Bones from both sides, every colour (a blocked bone now waits instead of re-rolling, which had biased them to blue), faster/denser. EXTREME mode + SHADES. Finisher pools: P1 STAR PATH / MAGEN DAVID / STAR BARRAGE / DAVID LASER; P2 STAR CAGE / SUKKAH / DAVID'S BLADE / SPINNING STAR; P3 STAR TORNADO; STAR OF HELL 5% anywhere (?fin=0..9). Clash TRIES dots. BLOOD SPIKES attack. Also fixed a bug from this batch where a comment swallowed the finisher start.
- NEXT (if any): Totality (phase 3) has only one finisher (STAR TORNADO) + STAR OF HELL; Extreme fights are long for the bot (1.6x HP + shades) — tune after the owner plays it.
- (Oct 2, owner) Beam clashes harder to beat; the 3rd phase must open only with a secret key sequence the owner knows (hinted in game), in every mode; more creative finishers; BLOOD SPIKES and SHADES only in EXTREME.
- DONE (Oct 2) P13: clash need +~12% (Normal 5.3, Hard 6.9, Extreme 7.6 taps/s base) and 1 more key per clash key moment, less time. Phase 3: typed while the eclipse aligns (phase 2, last stretch), in all modes; only an FNV-1a hash is in sim.js (SECRET); hint = a keyboard of stars in the sky lit in the code's order + end-screen text; P and M don't pause/mute while it's being typed; the old perfect-dodge way is gone. Test flag ?force=align. New phase-3 finishers: STAR DOMINOES, STAR RICOCHET, STAR COLLAPSE (?fin=10/11/12). Spikes + shades now EXTREME-only.
- (Oct 2, owner) Shades (minions) must be auto-targeted; finishers must not reuse effects (blue + gold accents); MAGEN DAVID shield in Israeli-flag colours with a standout star; "a specific explosion is reused, everything must look unique, something people would buy"; box hits sometimes don't register (walls in the droplet/sweep game).
- DONE (Oct 2) P13: aimed and homing shots lead the nearest shade, area moves (seal, halo, lance, starfall, judgement...) hit the nearest shade, shade HP lowered (~12 s with slashes only). Every finisher ends differently with its own accent (gold MAGEN/BARRAGE/DOMINOES/LASER, ice CAGE, cyan SPINNING, silver BLADE, teal TORNADO, red HELL, blue+gold COLLAPSE); the shared "big hit" explosion no longer plays on finisher hits (each has a final-hit signature instead); the screen-invert flash is kept only for HELL, COLLAPSE and BLADE. MAGEN DAVID shield = white disc, two blue stripes, bold blue star with a white halo, gold rim. Box: a dodge pressed as a box started kept its i-frames for the whole box (now never carried in), and droplet i-frames blocked walls (walls now have their own timer).
- (Oct 2, owner) Soul in the mini games a bit faster (not way too fast). DONE: free move 300→360, blue (gravity) 270→325, strings 290→350.
- (Oct 2, owner) MAGEN DAVID shield: flag stripes curved to the round shield, not a flag cut into a circle. DONE (curved blue bands top and bottom).
- (Oct 2, owner, big feedback) 1 s GET READY must be optional; "keep the explosion" (the old shared one was the cool part); COLLAPSE + black & white impact frames; RICOCHET ending more interesting; DOMINOES sucks (replace); MAGEN DAVID back to its first look, with the end-scene shield = blue ring between an outer and inner white circle, star in the middle; NOVA ability's second stage boring; things too high to see; DAVID LASER's old blow-up was better; gold = the phase-2 gold (#ffe08a), used in effects, not as outlines; SPINNING STAR ending too simple; BARRAGE was better before (no gold outlines); DAVID'S BLADE "a slideshow", remake clean; TORNADO needs effects + an explosion; STAR OF HELL: devil star (Algol), longest and coolest, effects in sync. Asked which MCP connectors could help VFX/polish.
- DONE (Oct 2) P13: GET READY toggle (title + pause, saved, off by default); big-hit explosion restored on finisher hits; impact() = black & white impact frames (COLLAPSE, BLADE, COMET, RICOCHET, SPINNING, TORNADO, BARRAGE, HELL); explosions keep the old blast but tinted per finisher; MAGEN DAVID original charge + new end shield; DAVID LASER original blow-up (+ gold sparks); SPINNING STAR blades boomerang back and detonate; BARRAGE blue stars, gatling of 3 gold-lit muzzles, original finish + gold fountain; DAVID'S BLADE remade (charge, 6 dashes along the star, cuts hang, sheathe, the star of cuts detonates); TORNADO dust, funnel lightning, real explosion; STAR COMET replaces DOMINOES (wings, launch, gleam, comet dive, crater); RICOCHET path lights up, snaps into her, detonates; STAR OF HELL remade: inverted pentagram (devil star), 12 s, hellfire column + flames + ground cracks, pentagram of lasers, vertical laser, 3 s exponential spin-up with lightning and overcharge strobe, impact frames, scorched pentagram; NOVA ability's second stage = rays + screen-wide star shockwave; finisher camera pulled back.
- (Oct 5, owner, screen recording) Everything should be "extreme", not simple. STAR OF HELL: opening laser/fire too simple; the star-spawn + laser + sky beam part bad; its key screen still had a Star of David behind it. Pressed keys should burn out, crack and fall off like glass. NOVA still not right ("it blows up into a smaller version"). Polish whatever isn't.
- DONE (Oct 5) P13: STAR OF HELL opening = hell portal with turning rune rings + inverted pentagram + twisting vortex fire beam (wavy heat layers, spiral rings, sparks) + ground fire splash rings and flames; middle = five demon eyes spawn one by one, orbit, fire crackling lightning-core lasers point to point then into her; the sky cracks open and a vortex beam crashes down with shockwave rings, flames and debris; synced sounds (hellEye, hellCrack). Key screen: devil star + flames, darker backdrop. All key prompts (finisher, rune, chains, clash): a pressed key flashes, burns to charcoal with embers, cracks, then shatters into falling glass wedges. NOVA: no longer pierces; it stops on her and detonates huge (blast 170-230 vs 70) with impact frames, rings, a flare.
