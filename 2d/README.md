# Touchline — International Soccer (2D)

A top-down, 7-a-side international football game for the browser. Plain ES modules and
`<canvas>` — no libraries, no CDNs, no build step.

## Running

Serve the repository root (ES modules need http, not `file://`) and open `2d/index.html`:

```sh
npx http-server . -p 8101 -s
# → http://localhost:8101/2d/index.html
```

Unit tests for the pure game logic (rules, physics, passing, shooting, kits, keybinds,
tournament, penalties, free kicks):

```sh
node 2d/tests/logic.test.mjs
```

## Modes

| Mode | What it is |
| --- | --- |
| **Quick Match** | You vs the CPU. Pick any two of 32 national teams (real home / away kits, automatic away kit on a colour clash). |
| **World Cup** | 16 nations, 4 groups, quarter-finals, semi-finals, final. Progress is saved in the browser; level knockout games go to a penalty shootout. |
| **Penalty Shootout** | First-person shootout: aim the reticle, charge the power bar (or use the slider), then keep goal and pick your dive. |
| **Free-Kick Practice** | Choose / randomise the spot, set curve and shot type (driven, dipping, knuckle), see the predicted path; goals, streak and best streak. |
| **Corner Practice** | Endless corners against a live defence: aim, power and curve the delivery, then attack it (hold Shoot for a header / volley). |
| **Local 2 Players** | Both players on one keyboard, versus or co-op against the CPU. |
| **Tutorial** | Interactive drills that advance when you perform each action. |
| **How to Play** | Controls (reflecting your current bindings) and rules. |

Settings: match length, difficulty (Easy / Normal / Hard / Legend), shooting assist
(Assisted / Precision / Manual), penalty power input (hold or slider), camera zoom, sound,
aim line, and fully rebindable controls for both players.

## Controls (defaults — all rebindable in Settings)

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | W A S D | Arrow keys |
| Shoot (hold to charge, release) | Space | Numpad 0 |
| Pass | J / left click | Numpad 1 |
| Through ball | E | Numpad 2 |
| Lob / lofted pass | Q | Numpad 3 |
| Sprint | Left Shift | Right Shift |
| Standing tackle | F | Numpad 4 |
| Slide tackle | C | Numpad 5 |
| Switch player | Tab | Numpad 6 |
| Skill move | R | Numpad 7 |
| Pause | Esc | Numpad + |

* **Aim** with the mouse; without recent mouse movement, aim follows your movement direction.
* **Shooting**: hold Shoot to fill the power bar; past the white mark you hit a *Rocket*. While
  holding, tap Lob for a *chip* or Through for a *finesse* curler. Hold Shoot as a ball arrives
  for a first-time *volley* or *header*. A dashed aim line and a reticle on the goal mouth show
  the target (green = on target).
  * *Assisted*: shots aimed broadly at goal are always on target.
  * *Precision*: exact aim; on-target aims get less error and +10 % pace.
  * *Manual*: exact aim; error from shooting skill, power, sprinting and pressure.
* **Set pieces** (corners, throw-ins, goal kicks, indirect free kicks): aim the reticle, hold
  Shoot for power and release, Pass plays it short, Lob / Through add curve. Direct free kicks
  near goal and penalties switch to the first-person view.
* **Tackling**: winning the ball first from the front is always clean; shoulder-to-shoulder is
  fair. Going through the man before the ball, or lunging in from behind on the player in
  possession, is a foul (slide from behind = yellow card, two yellows = red).
* **Skill moves**: no direction = step-over, sideways = roulette, backwards = drag-back,
  while sprinting = heel flick.

Rebinding: Settings → click an action → press the new key (Esc cancels). A key already in use
is swapped with the other action. Bindings are saved in `localStorage`, survive reloads and
apply immediately, including from the in-game pause menu. "Reset controls" restores defaults.

## Mobile / touch

* Floating joystick: touch anywhere on the left side and drag.
* Buttons on the right, around a big SHOOT button (hold to charge; aim follows the joystick).
* Penalty / free-kick views: drag on the screen to aim, hold the HOLD button (or set the slider
  and press KICK). As the keeper, tap where you want to dive.
* The page never scrolls or zooms during play, and a hint suggests landscape in portrait.
* On-screen controls only appear when the touch screen is actually used — never for mouse /
  keyboard players.

## Code map

| File | Responsibility |
| --- | --- |
| `js/main.js` | Boot, fixed-timestep loop, scenes, mode flows |
| `js/match.js` | Match state machine, possession, human control, tackles / fouls, keepers, replay |
| `js/ai.js` | Team AI and goalkeeper logic |
| `js/physics.js` | Ball flight, bounce, curve, posts / bar / nets, kick solver |
| `js/rules.js` | Goal line, out of play, restarts, tackle judgement (pure) |
| `js/passing.js`, `js/shooting.js` | Pass targeting / lane risk / speeds, shot planning (pure) |
| `js/setpieces.js` | Throw-ins, corners, goal kicks, free kicks in the top-down view |
| `js/kickscene.js`, `js/kickphys.js`, `js/view3d.js` | First-person penalties and free kicks |
| `js/cornerpractice.js`, `js/tutorial.js`, `js/tournament.js` | Practice, tutorial, World Cup |
| `js/render.js`, `js/ui.js`, `js/touch.js`, `js/input.js`, `js/keybinds.js` | Drawing, menus, controls |

`window.__touchline` exposes the app, input and current match / kick scene for debugging and
automated browser tests.
