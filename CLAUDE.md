# Tiny Worlds — Project Rules

Project: Tiny Worlds, idle game, TypeScript + Vite + Three.js.

## Core rules (from Part B, Section 10)

- Never import three or DOM in src/core. Core is pure and testable.
- All balance numbers live in src/core/config. No magic numbers elsewhere.
- Use Decimal (break_infinity) for currencies; never plain numbers for money.
- Simulation is fixed-step (0.1s). Rendering interpolates.
- Use InstancedMesh for repeated objects. No per-object meshes for trees/workers.
- Every core feature gets a Vitest test.
- Make small changes, run tests and the dev server after each, and explain what changed.
- Do not add libraries without asking.
- Keep files under about 300 lines; split by responsibility.
