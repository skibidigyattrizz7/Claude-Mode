# UI art direction — "looks like FC, not AI slop" (owner: current UI looks AI-generated)

## What's wrong now (coordinator audit, Sep 27)
- Generic "AI template" palette: navy + mint-green neon on everything; same glow/glass on every tile.
- Italic heavy display type everywhere, tiny low-contrast body text, lots of dead empty space.
- Gimmick copy ("2 games / 0 installs / ∞ rematches", "The beautiful game, in your browser").
- Bugs: 3D menu title overlaps the Online/Offline + account pills; forms float small in empty screens (Create Club).
- No real content: tiles are icons on gradients, no players/cards/stadium imagery.

## Target (EA FC 24–26 Ultimate Team menus)
- **Layout**: top tab bar (Home · Squads · SBC · Objectives · Transfers · Store · Club), content-dense hub of
  big image tiles in a 12-col grid; left-aligned headings; bottom hint bar with key/button glyphs.
- **Imagery first**: tiles show real content — the user's best player card, latest pack, SBC reward card, live
  objective progress, market listing — rendered with our card component, over a blurred stadium/pitch backdrop
  (procedural canvas/CSS), not icons on gradients.
- **Palette**: near-black charcoal (#0b0d10–#15181d) + ONE brand accent used sparingly (FC-like electric
  green-yellow or the season's promo colour), white text; promo colours only where the promo is.
- **Type**: one strong condensed sans for headings (upright, not italic everywhere; e.g. "Barlow Condensed"
  / "Oswald" via Google Fonts or system fallback) + clean sans for body (Inter/system). Body ≥ 14px, clear hierarchy.
- **Motion**: fast, purposeful (120–220 ms), tile hover = slight lift + image zoom, focus ring visible; no
  constant glow pulses.
- **Density**: fill the screen like FC — no small centred forms in empty space; forms become side panels/modals
  over content.
- **Copy**: plain, game-like ("Squad Battles", "Open packs"), no marketing slogans.
- **No debug buttons** visible outside debug mode.

## Screens (priority)
1. 3D main menu + UT hub (Home tab) 2. Squad 3. Store/packs screen 4. Transfer market 5. SBC 6. Club
7. Landing page 8. 2D menus 9. Settings/Account/Friends 10. In-match pause + HUD.

## Process rules for the agent
- Use skills: `anthropic-skills:impeccable` (anti-slop audit/polish) and `/root/.claude/skills/ui-ux-pro-max`.
- Screenshot every screen at 1366×768 and 390×844 BEFORE and AFTER; critique like a harsh art director; iterate
  until it would pass as a real game menu. Put before/after sheets in scratchpad/ui2/.
