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
