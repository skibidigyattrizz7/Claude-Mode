# Notes for Claude (owner's standing rules)

**New chat? Read `docs/HANDOFF.md` (how we work: tests, push procedure, Supabase, hosting, agents, gotchas) and `docs/BACKLOG.md` (what to do) first.**

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
This list wins over any design skill in `.claude/skills` (taste-skill, frontend-design, etc.) if they disagree.

## Other standing rules
- Work style (owner, Sep 29): use the engineering design process on everything (define → research → ideas → build →
  test → improve), for UI, design and animations too. Aim for the best result at the lowest token cost. Small
  decisions: just do them and tell the owner; bigger ones: do the sensible thing and ask/show them alongside.
- Hosting: GitHub Pages is the live game. Ignore Render and Vercel completely (owner, Sep 29).
- Don't change the online / multiplayer system unless it's really needed — it works.
- Admin codes are owner-only secrets: never write them into repo files; store hashes only.
- Supabase: never edit an applied migration; add a new numbered file, then rename it to
  the version Supabase records.
- Keep answers to the owner short and simple.
- Subagents (owner, Sep 30): Sonnet 5.5 for hard tasks, Sonnet 5 (or Haiku if Sonnet 5 is not selectable) for easier ones. Not Opus unless the owner says so.
- "Notes mode": when the owner sends info to save for later, append it to docs/BACKLOG.md and reply with one word ("Saved"). Minimal usage.

## Saving usage (owner's request)
- Start a fresh chat for each new batch of work; begin with "read CLAUDE.md, docs/HANDOFF.md and docs/BACKLOG.md and continue".
- Owner sends requests in batches; keep to 1–2 agents at a time.
- Give big standalone jobs to other AIs via docs/AI_PROMPTS.md; Claude reviews and merges their branches.
- Don't post "still working" chatter; report only when something finishes or needs a decision.
- Everything the owner asks for goes into docs/BACKLOG.md right away so nothing is lost between chats.
- Unfinished work lives on branch `wip/paused-work`.
