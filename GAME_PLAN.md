# Tiny Worlds: Game Plan
Status: Agreed

## Vision
Mobile-first 3D idle game (TypeScript + Vite + Three.js). A rotatable, pinch-zoomable planet. Workers plant trees, lumberjacks chop them, carriers (or the player tapping) collect logs, wood is sold to aliens for Credits, Credits buy workers and upgrades. Later: new planets with new mechanics, prestige, offline progress.

## Core loop
Plant sapling -> small -> medium -> grown -> lumberjack chops -> tree falls -> pile of 3 logs on the plot -> carrier or player tap collects -> plot empty -> planter replants. Wood is sold for credits (WOOD_PRICE = 2).

## Architecture rules
- src/core is pure logic: no three, no DOM. Core owns state; render only reads it.
- All balance numbers live in src/core/config. One shared game state object.
- Money only through shared helpers. Fixed simulation step.
- Every core feature gets a Vitest test.
- Work in small stages, commit after each working step.

## Current state (Planet 1, Verdant)
Built: sphere planet with 1500 plots, instanced trees, Planter/Lumberjack/Carrier AI with reservations, wood pipeline, mobile UI shell, dev menu, upgrades (Plant Speed, Chop Speed, Wood Value), pooled particles, tap-to-collect (exists, being hardened), save/restore.
Placeholders: side buttons, Prestige/Workers/Aliens/Shop tabs, AUTO BUY, 2X SPEED, quests, achievements.

## Current task
Tap-to-collect hardening: one tap collects one pile, wood +3 exactly once, plot becomes empty immediately, reservation released, no double count with carriers. Then: camera zoom (start with whole planet, zoom out up to 1.8x farther).

## Roadmap
1. Stabilize Planet 1 (tap-collect, camera).
2. Alien trade post with rotating demand.
3. Offline progress, quests, events, tutorial.
4. Playtest with friends, then Planet 2 (Rocky, Miner).
5. Prestige, factories, monetization, Capacitor wrapper.

## Do not
Do not start Planet 2 or new systems before Planet 1 is stable and tested.