Player animation review

Base: bdb0880 (claude/compassionate-gates-n9kfni).

The match screenshots show the actual engine-test.html AI match at DPR 1.
The pose sheets show the same procedural rig, kit, camera and sampled action times
before and after the change. They are isolated pose comparisons, not new game UI.

- before/after-match-1366.webp: 1366 x 768
- before/after-match-390.webp: 390 x 844
- before/after-poses-1366.webp: 1366 x 768
- before/after-poses-390.webp: 390 x 844

The ball-release pose now shows contact/follow-through, not another backswing.
The scorer's existing deterministic celebration variation can select a compact
backward somersault. Existing knee slide, arms-out and badge-kiss poses remain.
The geometry remains stylized and procedural; this is not a photorealistic model.
Existing match HUD styling is unchanged by this animation-only task.

Validation: all 394 tests in the requested command passed. Browser AI matches
rendered and advanced, with no console or page errors. SwiftShader software
rendering measured 3–4 FPS in this runner, so 60 FPS on a Chromebook is NOT verified.
A local CPU-only 22-rig benchmark (600 measured frames, world matrices included)
measured 0.062 ms median and 0.085 ms p95; this excludes GPU rendering and is not
an end-to-end frame-rate claim.
