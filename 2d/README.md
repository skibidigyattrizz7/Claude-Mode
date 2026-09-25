# Touchline — International Soccer (2D)

A top-down, 7-a-side international football game for the browser. Plain ES modules and
`<canvas>` — no libraries, no CDNs, no build step.

## Running

Serve the repository root (ES modules need http, not `file://`) and open `2d/index.html`:

```sh
npx http-server . -p 8101 -s
# → http://localhost:8101/2d/index.html
```

Unit tests for the pure game logic (rules, physics, passing + assist modes, shooting, kits,
keybinds, tournament, penalties, free kicks, AI defending / marking, first touch, momentum,
saved-kick restarts, gameplay settings):

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

Settings: match length, difficulty (Easy / Normal / Hard / Legend), penalty power input (hold
or slider), camera zoom, sound, aim line, fully rebindable controls for both players, and
FIFA-style **gameplay settings stored per player** (P1 / P2, saved in `localStorage`, applied
immediately, also from the pause menu):

| Group | Setting | Options |
| --- | --- | --- |
| Passing | Ground pass / Through ball / Lob & cross | **Assisted**: team-mate nearest the aim (wide cone), automatic power, leads the runner to his feet, no error — only an interception stops it. **Semi**: narrower cone, the aim matters more, power from hold time blended with the ideal pass, small passing-skill error. **Manual**: no targeting — exactly along the aim with the power you hold. |
| Shooting | Shot assistance | **Assisted**: aimed broadly at goal = always on target. **Precision**: exactly where aimed; on target it is 10 % faster with half the error. **Manual**: exact aim, full error. |
| | Timed finishing | Tap Shoot again as the closing ring meets the player (at contact): green = better strike, red (early / late) = worse. |
| | Shot error realism | Off: skill, sprinting and pressure no longer add error. |
| Defending | AI defending | **Assisted**: nearest AI team-mate presses (or contains, if you're engaging) and the rest cut passing lanes. **Tactical**: you do the work; team-mates hold shape and only contain when you are far away. |
| | Auto marking / Auto tackle / Auto clearances | Team-mates track runners · your player pokes the ball away when it is clean · first-time clearances in your own box under pressure. |
| Switching | Auto switching | **Auto** (defending + high balls) / **Air balls only** / **Manual**. |
| | Switch indicator / Pass receiver lock | Dashed ring on the player Switch will pick · stay locked to the receiver until the ball arrives. |

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
| Jockey / shield (hold) | V | Numpad 8 |
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
* **Passing** is firm: ground passes arrive at 8–12 m/s (launch speed grows with distance) so
  they reach the receiver quickly, and the receiver moves to meet the ball. Through balls are
  played into space ahead of the runner (lead = runner speed × arrival time, typically 20–35 m).
* **Jockey / shield** (hold V): defending, face the carrier and side-step (no direction = stay
  goal-side of him); on the ball, turn your back on the nearest defender and shield it.
* **Feel**: momentum-based turning (arcs and braking at full sprint), contextual first touch
  (fast balls, sprinting and pressure → heavier touches; better dribblers are cleaner),
  shoulder-to-shoulder duels decided by strength, blocked / deflected passes.
* **AI**: wide players hold width, full-backs overlap, the central midfielder underlaps,
  forwards attack the near post for crosses, passers make give-and-go runs, team-mates offer
  an angle to a pressed carrier; defenders clear under pressure (often into touch). Keepers
  rush out and smother 1v1s, come for crosses and punch in a crowd.
* **Restarts**: tap Pass during the whistle for a *quick* throw-in / free kick. A saved penalty or
  direct free kick is held, turned behind for a corner, or parried back into play for a scramble.
  AI-only matches (menu demo, simulations) resolve penalties / direct free kicks automatically.
* **Pause menu**: match facts (possession, shots, pass accuracy, fouls, corners) and an
  **instant replay** of the last ~8 s. Goal replays, celebrations and kick results are skippable.

Rebinding: Settings → click an action → press the new key (Esc cancels). A key already in use
is swapped with the other action. Bindings are saved in `localStorage`, survive reloads and
apply immediately, including from the in-game pause menu. "Reset controls" restores defaults.

## Mobile / touch

* Floating joystick: touch anywhere on the left side and drag.
* Buttons on the right, around a big SHOOT button (hold to charge; aim follows the joystick),
  including JOCKEY (hold) for jockeying / shielding.
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
| `js/passing.js`, `js/shooting.js` | Pass targeting / assist modes / lane risk / speeds, shot planning (pure) |
| `js/feel.js` | First-touch heaviness, shoulder duels, timed finishing, saved-kick restarts (pure) |
| `js/settings.js` | Persistent settings incl. per-player gameplay assists |
| `js/setpieces.js` | Throw-ins, corners, goal kicks, free kicks in the top-down view |
| `js/kickscene.js`, `js/kickphys.js`, `js/view3d.js` | First-person penalties and free kicks |
| `js/cornerpractice.js`, `js/tutorial.js`, `js/tournament.js` | Practice, tutorial, World Cup |
| `js/render.js`, `js/ui.js`, `js/touch.js`, `js/input.js`, `js/keybinds.js` | Drawing, menus, controls |

`window.__touchline` exposes the app, input and current match / kick scene for debugging and
automated browser tests.
