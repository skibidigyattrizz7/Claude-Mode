# Claude-Mode

Two browser soccer games. Nothing to install: open `index.html` from any static server, or play on GitHub Pages.

| Game | Folder | What it is |
|---|---|---|
| **Touchline** | `2d/` | 2D international soccer: 7-a-side vs AI, World Cup, first-person penalties, free-kick & corner practice, tutorial, local 2P, mobile joystick |
| **Pitchside 3D** | `3d/` | FIFA-style 11v11 in Three.js: Career Mode, Ultimate Team (packs, SBCs, chemistry), local 2P, online 1v1 (PeerJS) |

Run locally: `npx http-server . -p 8080` → http://localhost:8080

Tests:
```
node 2d/tests/logic.test.mjs
node 3d/js/engine/tests/physics.test.mjs
node 3d/js/meta/tests/meta.test.mjs
```

Docs: `docs/3D_CONTRACT.md` (3D module API), `docs/PROMPT.md` (prompts to rebuild both games), `docs/IDEAS.md` (feature ideas).

All player names, clubs and sponsors are fictional. Packs use in-game coins only.
