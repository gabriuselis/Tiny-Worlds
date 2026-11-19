# Tiny Worlds project context

## Mandatory game plan

Before any repository change, check `GAME_PLAN.md`.

Do not change code, tests, assets, configuration, documentation, or agent instructions unless `GAME_PLAN.md` exists and contains an agreed game idea, progression path, MVP scope, and completion criteria. A placeholder, draft, or plan inferred from existing code does not count.

The only permitted write while this requirement is unmet is creating or updating `GAME_PLAN.md` after the developer has reviewed and explicitly agreed to its contents. Keep drafts in the conversation until then. Read-only repository inspection is allowed.

If `GAME_PLAN.md` is missing or incomplete, stop the requested implementation. Do not make a small fix first. Do not quietly choose a game direction.

## What to do when the plan is missing

1. Inspect the repository read-only and give the developer a rough, accurate overview of the current game code: what the player can do, how the simulation and rendering work, what systems are only partial, and where the existing code leaves product decisions unanswered.
2. State the immediate problem plainly: `GAME_PLAN.md` does not exist, so there is no agreed game idea or route to an MVP. Explain that you need to define those before making repository changes.
3. Offer the developer two ways to proceed:
   - They can share their thoughts, ideas, references, or imagination in any form, including rough notes.
   - You can guide them through questions about the game direction.
4. If they share ideas, summarize them and ask about the important gaps. If they choose questions, work through the question bank below in manageable rounds. Ask follow-up questions when answers reveal new decisions. Do not force the developer to answer every question if a choice is already clear.
5. Turn the answers into a proposed game concept, player loop, progression, and MVP. Show the proposal in chat, distinguish the developer’s decisions from your suggestions, and request corrections.
6. Once the developer explicitly agrees, write `GAME_PLAN.md` with `Status: Agreed`. Only then may repository implementation resume.

Do not mention `AGENTS.md`, `CLAUDE.md`, or internal instruction rules in ordinary replies. It is appropriate to name the missing `GAME_PLAN.md` and explain its practical consequence.

## Guided question bank

Start with the questions that determine the core idea. Continue into the other groups as the conversation develops.

### Fantasy and identity

1. What is the player meant to feel they are building or becoming?
2. Why are these worlds tiny? Is that central to the game’s identity or mainly its visual style?
3. What makes this game distinct from other idle or automation games?
4. Should the tone be cozy, playful, strategic, mysterious, or something else?
5. Is there a story or larger purpose behind developing the planets?

### Player activity

6. What does the player actively do during the first five minutes?
7. What should workers automate, and what should always remain a player decision?
8. Is the main satisfaction watching a living world, optimizing production, discovering new worlds, completing objectives, or a combination?
9. How much direct interaction should the 3D planet have beyond rotating and zooming?
10. What should make the player want to return after closing the game?

### Progression and economy

11. What is the first meaningful achievement after the Verdant wood loop starts?
12. What does earning credits unlock, and why are those unlocks exciting?
13. When and why does the player reach another planet?
14. Should planets introduce different mechanics or mainly new resources and visuals?
15. How do resources from different planets interact?
16. Are there buildings, crafting chains, quests, or research? Which are essential?
17. Should prestige or a reset mechanic exist? What new possibility would it unlock?
18. What choices or tradeoffs should prevent progression from feeling automatic?

### Pace and presentation

19. How long should the first session take before the player sees a major milestone?
20. How much progress should happen while the game is closed?
21. Is the intended experience primarily desktop, mobile, or both?
22. What visual moments should make progression feel tangible on the planet?
23. Are there games, artwork, or other references that capture the desired feel?

### MVP boundary

24. What is the smallest complete version you would be proud to show someone?
25. What must a new player be able to accomplish from start to finish in that version?
26. Which current or proposed systems can wait until after the MVP?
27. How will we know the MVP is complete and playable?

## Plan requirements

`GAME_PLAN.md` must contain:

- `Status: Agreed`
- The core game idea and player fantasy
- The player’s short-session and returning-player loops
- The progression path and major unlocks
- The role of each system included in the MVP
- Explicit MVP inclusions and exclusions
- Observable completion criteria
- Open questions that do not block implementation

Check the plan again at the start of every later task. If it becomes contradictory or no longer describes the intended game, pause implementation and resolve the direction with the developer before continuing.

## Existing code is evidence, not the game plan

The current prototype is a Three.js browser idle game centered on Verdant. Planters grow trees, lumberjacks cut them, and carriers deliver logs for credits. Worker hiring and upgrades exist. Other planets, prestige, and offline progress have partial code or configuration. None of this establishes the intended game idea, progression, or MVP.

## Implementation conventions after the plan is agreed

- Never import Three.js or DOM APIs in `src/core`. Keep core logic pure and testable.
- Keep balance numbers in `src/core/config`.
- Use Decimal (`break_infinity`) for currencies.
- Keep simulation fixed at 0.1-second steps; rendering interpolates.
- Use `InstancedMesh` for repeated trees and workers.
- Add a Vitest test for each new core feature.
- Make focused changes, run tests and the dev server, and explain the changes.
- Ask before adding libraries.
- Keep source files under about 300 lines when practical; split by responsibility.
- Use the repository’s Three.js skills for relevant API and rendering work. Check the installed Three.js version before applying examples.
