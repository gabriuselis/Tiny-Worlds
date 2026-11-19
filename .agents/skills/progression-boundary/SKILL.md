---
name: progression-boundary
description: Use when changing Tiny Worlds progression, economy, workers, upgrades, prestige, saves, simulation rewards, or user-state synchronization. Keeps every runtime progression mutation inside the class-based local cache and remote sync path.
---

# Tiny Worlds progression boundary

The shared `GameState` is mutated in place. Durable progression includes currencies, wood totals, upgrades, prestige, stats, worker roster, planet unlocks and resources, buildings, quests, and settings. Plots, worker positions, simulation time, and recent log timestamps are local world data.

For every runtime progression change, enter through `ctx.progression` in `src/app/progression.ts`. Add a named method there for a new production command. That method applies a deterministic core command and synchronously updates progression through `LayeredProgressionStore` in `src/persistence/layeredStore.ts`. The store handles revision increments, the local cache, remote reconciliation, and debounced remote writes. Use `advance()` for fixed simulation steps. `devChange()` is for dev hooks only. Do not mutate progression directly from app, render, UI, or dev code, and do not write progression directly to `localStorage` or call the remote repository directly.

Keep pure rules in `src/core`; they may mutate a passed state but cannot use DOM, storage, network, ambient time, or ambient randomness. Inject time and IDs. The app's progression class owns runtime calls to those rules. Keep the game and planet objects in place so existing references stay valid.

Headless tests and dev self-tests may call core commands on isolated game objects. They must never use those objects as the live game state.

The local world snapshot may save on its 15-second cadence. Progression changes must update the local progression cache synchronously and enter the remote write queue. Remote results reconcile by revision; on a tie, remote wins. The current remote adapter intentionally returns `null` and `void` until a DB exists. Keep legacy save migration in `src/core/save.ts` and `src/persistence/localCache.ts`.

For each progression change, add a meaningful Vitest test proving the class path updates the local cache and is eligible for remote sync. Run `npm run lint`, `npx vitest run`, and `npm run build`. Before shipping storage or processing of personal information, flag legal/compliance review.
