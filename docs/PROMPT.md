# Prompt: rebuild these games from scratch

Paste either prompt into Claude (or any coding AI). Each one works by itself.

---

## Prompt 1: "Touchline", a 2D international soccer game

> Build a complete browser soccer game called **Touchline: International Soccer**. Use plain HTML, CSS and JavaScript with a Canvas renderer and ES modules. Don't use a build step or any external libraries, and make sure it runs from any static server. Split the code into modules for data, physics, match rules, AI, rendering, input, shooting, set pieces, penalties, UI, audio and storage. Wrap every localStorage call in try/catch.
>
> **Teams and match**
> - Include at least 24 real national teams. Each one gets its real home jersey colours and an away kit, and the game switches to the away kit automatically when the colours clash.
> - Draw numbered shirts on the players. Use fictional surnames. Team rating should change AI speed and accuracy.
> - Matches are 7-a-side against the AI.
> - Draw a full pitch: halfway line, centre circle and spot, both boxes, 6-yard boxes, penalty spots, D-arcs, corner arcs, goals with nets and striped grass.
> - Add a broadcast-style scoreboard with team codes, kit colour chips, the score, a 0–90' clock and added time.
> - Include kickoff, halftime with a side swap and a fulltime stats screen (possession, shots, on target, passes, fouls, corners).
> - After a goal, show a celebration banner and a 4-second replay.
>
> **Physics**
> - Run the physics at a fixed 120 Hz, separate from rendering.
> - The ball needs velocity, friction, height with gravity and bounce, and Magnus-style curve from spin.
> - The ball should collide with players, and posts and the crossbar can bounce it back out. The net stops the ball.
> - Detect when the ball goes out and award throw-ins, corners and goal kicks to the correct team.
> - **One authoritative goal-line function.** A goal counts when the whole ball crosses the line between the posts and under the bar. A save can only happen before that. The game must never show "SAVED" for a ball that went in.
>
> **Tackling**
> - Add a standing poke tackle and a slide tackle. The slide commits the player and needs recovery time.
> - A tackle is a foul only in two cases: the tackler touches the body before the ball, or tackles from clearly behind (more than about 120° off the opponent's facing) and misses.
> - A front-on tackle that wins the ball is always clean.
> - Show the foul reason on screen. A reckless slide from behind gets a yellow card, and a second yellow means a red.
>
> **Passing**
> - A ground pass picks the best teammate inside a 45° cone in the aim direction. Score the candidates by angle, distance and whether an opponent can cut the pass out.
> - Lead the receiver by their velocity and set the pass speed so the ball arrives where they will be.
> - A through ball goes into space ahead of the runner. A lob is an aerial ball.
> - The receiver moves to meet the ball, and control switches to them automatically.
> - Passes should never go out of play unless the player aims them out.
>
> **Shooting**
> - Hold the shoot button to charge a visible power bar and release to shoot.
> - While dribbling, always show an aim line and a target reticle on the goal mouth.
> - Shot types: driven, finesse (curled), chip, power (less accurate) and first-time volley.
> - Error grows with power and pressure and shrinks with the shooter's shooting attribute.
> - Add a setting with three shooting modes:
>   - **Assisted**: if the aim is roughly towards goal, the shot always goes on target.
>   - **Precision**: the ball goes exactly where you aim. On-target aims get less error and +10% speed.
>   - **Manual**: fully manual, with no snapping at all.
>
> **Goalkeepers and AI**
> - Keepers position themselves on the angle and dive with reach based on rating.
> - They can catch, parry into rebounds or occasionally fumble, then throw or kick the ball out.
> - The team AI keeps formation shape, presses, marks, makes support runs and chooses whether to pass, dribble or shoot.
> - Add four difficulty levels: Easy, Normal, Hard and Legend.
>
> **Set pieces**
> - Free kicks use a jumping wall, an aim reticle, a power bar and adjustable curve, with the curved path previewed on screen.
> - Corners let you pick the target, power and curve. Throw-ins can be short or long. Include goal kicks.
> - A foul in the box triggers a penalty in first-person view.
>
> **First-person penalties** (also a standalone best-of-5 shootout with sudden death)
> - Show a pseudo-3D view from behind the ball, with a perspective goal, a diving keeper and a crowd.
> - Aim a reticle and use a power bar. You can hold to charge or set power with a slider.
> - Overpowered shots can fly over the bar, and aiming near the posts risks hitting the woodwork or missing.
> - When you're the keeper, you pick the dive direction and timing.
> - AI takers must score about 70–80% of the time, with realistic misses and saves.
>
> **Free-kick practice**
> - Pick any spot around the box.
> - Adjust power, curve and shot type (driven, dipping or knuckle).
> - Track goals, attempts and your streak. Add a corner-practice option too.
>
> **Controls**
> - Rebindable keys that actually work. Clicking an action waits for the next key press. Escape cancels. Warn on conflicts or offer to swap. Save the bindings, apply them right away and include a reset button. Write a test for it.
> - Default keys: WASD to move, mouse to aim, Space to hold and release a shot, click or J to pass, E for a through ball, Q to lob, Shift to sprint, F to tackle, C to slide, Tab to switch player, R for a skill move and Esc to pause.
> - Keyboard-only aiming follows the movement direction.
>
> **Mobile**
> - Add a Roblox-style floating joystick on the left and buttons on the right: shoot (hold to charge power), pass, through ball, lob, sprint, tackle and switch player.
> - Scale the canvas to the screen, block scrolling and zooming during play and suggest landscape mode.
> - In penalty and free-kick modes, drag to aim.
>
> **More features**
> - At least 3 skill moves (roulette, step-over, drag-back, heel flick) that cost stamina.
> - Stamina for every player.
> - A World Cup tournament with groups, knockouts and penalties, saved between sessions.
> - Local 2-player on one keyboard.
> - An interactive tutorial that moves to the next step when you do the action, plus a How to Play page.
> - Menus: main menu, team select with kit previews, settings (length, difficulty, shooting mode, sound, keybinds, aim line, zoom) and a pause menu.
> - A camera that follows the play, plus a minimap.
> - WebAudio-synthesised sounds for kicks, the whistle, the crowd and the net.
>
> **Quality**
> - Aim for 60 fps with no console errors.
> - Write a `node` unit-test file for goal vs save, the foul rules, pass targeting and speed, assisted snapping, the precision bonus and keybind save/load.
> - Smoke-test it in a real browser, including a mobile viewport.

---

## Prompt 2: "Pitchside 3D", a FIFA-style 3D football game

> Build **Pitchside 3D**, a FIFA-style 3D football game for the browser. Use ES modules with Three.js vendored locally, no build step, and procedural visuals only (no model or texture files). Don't use FIFA or EA trademarks or real player names. Real countries and their kit colours are fine.
>
> **Match engine**
> - A full 105×68 m pitch with correct markings and striped grass. Goals with posts and a rippling net. Stands with an instanced crowd, ad boards, a day or night lighting option and shadows.
> - 11 v 11 low-poly humanoid players animated in code: idle, jog, sprint, pass, shoot wind-up, slide, header, GK dives and celebrations.
> - Kits come from team data, with shirt numbers on the back.
> - Player attributes affect everything: pace (pac), shooting (sho), passing (pas), dribbling (dri), defending (def), physical (phy), plus the GK stats: diving (div), handling (han), kicking (kic), reflexes (ref), speed (spd) and positioning (pos).
> - Stamina drains when sprinting.
> - The ball is a 3D rigid body with gravity, drag and Magnus curl, bounces and rolls. It collides with the posts, bar, net and player bodies. Physics runs at a fixed 120 Hz.
>
> **Controls**
> - FIFA-like controls relative to the camera: sprint, pass (targeted and led to the receiver), through ball, lob or cross, and shoot with a power bar. Overpowered shots go over.
> - Also include a finesse curl, standing and slide tackles, switching player and 4 skill moves.
> - Support the Gamepad API and a touch joystick with action buttons.
>
> **Rules**
> - Kickoffs, throw-ins, corners, goal kicks and fouls. Front-on tackles that win the ball are clean.
> - Cards, free kicks with a wall, penalties with an error chance, offside at the moment of the pass, halftime side swap, added time and a strict goal-line rule.
>
> **AI**
> - Keeps formation shape, holds a defensive line, presses, marks, overlaps and makes decisions weighted by attributes and difficulty.
> - Keepers position on the angle, catch or parry, and distribute the ball.
>
> **Presentation**
> - A broadcast camera plus a "pro" camera behind the player.
> - Goal replays from a different angle.
> - A FIFA-like scoreboard, radar, power bar, event banners and a pause menu.
> - Synthesised crowd, kick, whistle and net sounds.
>
> **Career Mode**
> - Pick a fictional club from generated leagues. Play a double round-robin league and a cup.
> - Play each match or simulate it. Show the league table, top scorers, morale, form, fitness, injuries and player growth based on age, potential and match ratings.
> - Transfers with budgets, bids and counter-offers, transfer windows, a youth academy and board objectives.
> - Promotion and relegation, then aging, retirements and regens over multiple seasons. Multiple save slots.
>
> **Ultimate Team**
> - Generate at least 1,500 fictional players with a seeded RNG. Each has position-weighted stats, potential, weak foot, skill moves and a rarity (bronze, silver, gold, in-form, hero, legend).
> - The coin store sells packs with the odds shown on screen. There is no real money anywhere.
> - The pack-opening animation should shake the pack and burst in the colour of its best rarity. Players rated 84+ get a walkout: flag, then position, then club, then the card flips in.
> - FIFA-style player cards.
> - A squad builder with drag-and-drop (tap-to-place on mobile), formations, a bench and chemistry by club, league and nation, with chemistry links drawn between players.
> - At least 8 SBCs with a live requirement checklist.
> - Also objectives, Squad Battles against AI clubs and a lite transfer market.
>
> **Multiplayer**
> - Local 2-player: split keyboard, or a keyboard and a gamepad.
> - Online 1v1 through PeerJS (WebRTC) using room codes. The host runs the simulation and sends compact snapshots about 20 times a second. The guest sends its inputs and interpolates between snapshots.
> - Players pick national teams or bring their Ultimate Team squad. Handle disconnects cleanly.
>
> **Architecture**
> - Engine: `createMatch(container, {home, away, halfMinutes, difficulty, controllers, netRole, keybinds, onEvent, onEnd})` with `pause`, `resume`, `destroy`, `setRemoteInput`, `getSnapshot`, `applySnapshot` and `getLocalInput`.
> - Meta: `mountMeta(container, {startMatch})`.
> - Rebindable keys and a responsive menu UI.
> - Unit tests for the pure logic and browser smoke tests with no console errors.

---

## How the Claude version was built

Here is what I added beyond your original chat:

- The real bugs you hit are written into the prompt as rules: random fouls, passes going out of play, "saved" shown on goals and keybinds that didn't save.
- The 3D game has an exact API contract, so the engine, career/UT and multiplayer can be built separately and still fit together.
- Unit tests are required for the parts that were buggy before.
