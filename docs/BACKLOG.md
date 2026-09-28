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
- Super admin code is now `12345678910` (client hash updated in `3d/js/shared/adminauth.js`; server hash inserted by coordinator). It "didn't work at all" before — verify the whole flow end-to-end in the UI.
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
