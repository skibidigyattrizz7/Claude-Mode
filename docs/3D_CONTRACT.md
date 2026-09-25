# 3D game — module contract (shared by all agents)

Game name: **Pitchside 3D** (original name — never use FIFA/EA/club/league trademarks or real player names).
Real country names + their real home/away kit colours are fine. All player names are fictional and generated.

No build step. Plain ES modules served statically from `3d/`. Open `3d/index.html` via any static server.
- Three.js: `import * as THREE from '../vendor/three.module.min.js'` (path relative to file; r170, vendored).
- PeerJS (online multiplayer only): classic script `3d/vendor/peerjs.min.js` → `window.Peer`.
- No other external deps, no CDNs, no network needed except PeerJS signalling for online play.

## Directory ownership
| Path | Owner |
|---|---|
| `3d/js/engine/**` | Engine agent (3D match: rendering, physics, AI, controls, camera, HUD) |
| `3d/js/meta/**`, `3d/css/meta.css` | Meta agent (career, ultimate team, packs, SBCs, player DB, save data) |
| `3d/index.html`, `3d/js/main.js`, `3d/js/net/**`, `3d/css/main.css` | Integration agent (menus shell, wiring, online multiplayer) |
| `3d/js/shared/**` | Written first (by coordinator); read-only for others |

## Team object (the ONLY format passed into a match)
```js
{
  id: 'BRA',                 // unique
  name: 'Brazil',
  short: 'BRA',
  kit: { primary: '#FEDD00', secondary: '#009C3B', number: '#009C3B', shorts: '#002776', socks: '#FFFFFF' },
  gkKit: { primary: '#1a1a1a', secondary: '#444', number: '#ffffff', shorts: '#1a1a1a', socks: '#1a1a1a' },
  formation: '4-3-3',        // one of '4-3-3','4-4-2','4-2-3-1','3-5-2','4-1-2-1-2'
  players: [                 // exactly 11 starters, index 0 = GK, then in formation order (defence→attack)
    { id:'p123', name:'R. Alves', number: 1, pos:'GK', ovr: 84,
      attrs: { pac:70, sho:40, pas:65, dri:60, def:50, phy:78,
               // GK-specific (present for everyone, meaningful for GK)
               div:85, han:82, kic:75, ref:86, spd:60, pos:83 } },
    ...
  ],
  bench: [ /* 0..7 more players, same shape, used for substitutions */ ],
  chemistry: 0..100          // optional; engine may apply up to ±5% attribute scale
}
```
Positions: `GK, CB, LB, RB, LWB, RWB, CDM, CM, CAM, LM, RM, LW, RW, ST, CF`.

## Engine public API — `3d/js/engine/index.js`
```js
export function createMatch(container /* HTMLElement */, opts) -> MatchHandle
opts = {
  home: Team, away: Team,
  halfMinutes: 3,                 // real minutes per half (clock shows 0–90)
  difficulty: 'amateur'|'pro'|'world'|'legendary',
  controllers: { home: 'p1'|'p2'|'ai'|'remote', away: 'p1'|'p2'|'ai'|'remote' },
  netRole: 'local'|'host'|'guest',   // host = authoritative sim; guest = renders snapshots only
  keybinds: {...} | undefined,       // see shared/keybinds.js defaults
  stadium: 'day'|'night',
  onEvent(evt),                   // {type:'goal'|'halftime'|'fulltime'|'foul'|'card'|'sub', ...}
  onEnd(result),                  // {homeGoals, awayGoals, scorers:[{playerId, team, minute}], stats:{possession:[h,a], shots:[h,a], shotsOnTarget:[h,a], passes:[h,a]}, playerRatings:{[playerId]: 4.0..10.0}}
}
MatchHandle = {
  pause(), resume(), destroy(),
  // networking hooks (used by 3d/js/net/*):
  setRemoteInput(side /* 'home'|'away' */, input /* InputState */),
  getSnapshot() -> plain JSON-serialisable object (positions, velocities, ball, score, clock, state),
  applySnapshot(snap),            // guest only: interpolate toward it
  getLocalInput(side) -> InputState, // what local keyboard/touch is producing this frame
}
InputState = { mx, my /* -1..1 move */, aimX, aimY /* -1..1 camera-relative */, sprint, pass, through, lob, shoot, shootPower /* 0..1 while held */, switchP, tackle, skill, finesse }  // booleans except numbers
```

## Meta public API — `3d/js/meta/index.js`
```js
export function mountMeta(container, { startMatch }) -> { showCareer(), showUltimateTeam(), destroy() }
// startMatch(home: Team, away: Team, opts) -> Promise<result>  (provided by main.js; wraps createMatch)
export function getNationalTeams() -> Team[]      // ≥ 24 national teams w/ real kit colours, fictional players
export function getSavedUltimateTeam() -> Team|null  // the user's current UT squad as a Team (for online play)
```
Persistence: `localStorage` keys prefixed `pitchside.` (wrap every access in try/catch).

## Shared (`3d/js/shared/`)
- `keybinds.js` — default keybinds + load/save (`pitchside.keybinds`).

---
# V2 additions (gameplay settings, real players, online UT, market, admin)

## Gameplay settings — `3d/js/shared/gameplay.js`
`createMatch` accepts `opts.gameplay = { home: GameplaySettings, away: GameplaySettings }` (either may be omitted → defaults). Semantics:
- **passAssist**: *assisted* = the pass goes perfectly to the teammate closest to your aim direction (widest cone, auto power, leads runner, never misses the target); *semi* = same targeting but narrower cone and power follows the hold time, small error from passing attr; *manual* = exact stick direction and held power, no targeting.
- **shotAssist**: *assisted* = if aim is broadly toward goal the shot is always on target (snapped inside the frame); *precision* = shot goes exactly where aimed; if that point is on target it gets +speed/+power and much less error; *manual* = exact aim, error from attributes/power/pressure, no snapping.
- Others as commented in the file.

## Settings extras — `createMatch` also honours `opts.camera` ('broadcast'|'pro') and `opts.volume` (0..1), and `opts.knockout: true` → if level at full time: extra time (2 short halves) then penalty shootout; result then includes `pens: [h, a]`.

## Online services — `3d/js/net/services.js` (owned by the net agent)
All return Promises and must never throw to the caller when offline — they resolve `{ ok:false, error }` instead.
```js
export const online = {
  available() -> Promise<boolean>,                    // backend reachable + configured
  profile() -> Promise<{ok, id, name, coins, rating, division}>,   // creates an anonymous profile on first use
  setName(name),
  // Player transfer market (real players' listings; separate from the AI market in meta)
  market: {
    list(card /* full UT card object */, price) -> {ok, listingId},
    search({ q, pos, minOvr, maxPrice, rarity, sort, page }) -> {ok, items:[{listingId, card, price, seller, listedAt}]},
    buy(listingId) -> {ok, card},                     // server moves coins atomically
    mine() -> {ok, items},                            // my active + sold listings
    cancel(listingId) -> {ok, card},
    claimSales() -> {ok, coins},                      // credit coins for sold items
  },
  coins: { get(), add(delta, reason) },             // online coin balance (server-held)
  // Matchmaking — both options
  matchmaking: {
    quickSearch({ mode: 'friendly'|'ut', team }) -> Promise<{ok, transport, role:'host'|'guest', opponent}>,
    cancelSearch(),
  },
  hostWithCode(), joinWithCode(code),                // existing PeerJS code rooms
  reportResult({ mode, won, drawn, goalsFor, goalsAgainst }) -> {ok, coinsAwarded, rating},
  admin: { verify(code) -> Promise<boolean> },      // server-side check; code never stored in client
};
```
## Meta additions
`mountMeta(container, { startMatch, startOnlineMatch, online, onExit })`:
- `startOnlineMatch({ mode:'ut', team }) -> Promise<result>` provided by main.js (runs matchmaking + online match).
- `online` is the services object above (meta uses `online.market.*`, `online.coins`, `online.admin.verify`).

## V2.1 — player physique + PlayStyles (added to every player object in Team.players / bench)
```js
height: 1.62..2.02,            // metres; GKs mostly 1.86–2.00; affects reach, headers, GK dive reach, stride, and render scale
weight: 58..100,               // kg; affects shoulder challenges/shielding with phy
playstyles: [{ id: 'finesse', plus: false }, ...]   // 0..4 total, count scales with OVR (<70: 0–1, 70–79: 1–2, 80–86: 2–3, 87+: 3–4); at most 1–2 'plus' for 85+
```
PlayStyle ids (FC-style): attack `finesse, power, chip, deadball, trivela, lowdriven, powerheader, acrobatic`; passing `incisive, tikitaka, pinged, longball, whipped`; ball control `firsttouch, technical, rapid, flair, trickster, pressproven`; defending `anticipate, intercept, block, jockey, slidetackle, bruiser, aerial`; physical `quickstep, relentless, longthrow`; GK `farreach, footwork, rushout, crossclaimer, quickreflexes, deflector`. Plus version = stronger effect. Engine: missing fields → defaults (height 1.80, weight 75, playstyles []).
