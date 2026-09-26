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

## Work order (max 2 agents at once; next starts when a slot frees)
1. A — accounts/admin/economy (coins, market, refresh, transfer list, super code) [resume]
2. B — UT content/rules (+ vault, unreleased promos hidden, more promos, rules) [resume]
3. C — UT UI (squad builder, admin panel, tactics visible, gifts, rewards) [resume]
4. G — 3D engine (receiver, AI defending, proxy/Chromebook loading, faster stadium) [resume]
5. F — 2D gameplay + 2D online [resume]
6. UI redo round (all screens, FC quality) + promo themes for new promos
