# Notes for Claude (owner's standing rules)

## "Looks vibecoded" list — ask first, with a picture
The owner shared a reference list of 20 things that make an app look AI-made.
These are **not banned**, but before using ANY of them anywhere (either game, menus,
docs pages), ask the owner first and **show a screenshot/mockup of it** so they can
approve. Don't just ask in words.

1. Purple-to-blue gradient
2. Gradient hero text
3. Emojis in headings
4. Inter font everywhere
5. Colored border cards
6. Glassmorphism cards
7. Low-contrast dark mode
8. 3 icon boxes in a row
9. Badge above the headline
10. Lucide icons everywhere
11. Untouched shadcn UI
12. Fade-in on scroll
13. Cursor-following beam
14. Buttons fade on hover
15. Inconsistent spacing
16. Em dashes everywhere (in UI copy)
17. Generic buzzword copy
18. Serif italic accents
19. Space Grotesk + Instrument Serif
20. Grain over a gradient

If existing UI already uses one of these, flag it to the owner (with a screenshot)
rather than silently keeping or adding more of it. See also `docs/UI_DIRECTION.md`.

## Other standing rules
- Don't change the online / multiplayer system unless it's really needed — it works.
- Admin codes are owner-only secrets: never write them into repo files; store hashes only.
- Supabase: never edit an applied migration; add a new numbered file, then rename it to
  the version Supabase records.
- Keep answers to the owner short and simple.
- Subagents: Haiku for small/simple tasks, Sonnet or an older (cheaper) Opus for bigger coding tasks. Not the newest Opus unless the owner says so.
- "Notes mode": when the owner sends info to save for later, append it to docs/BACKLOG.md and reply with one word ("Saved"). Minimal usage.
