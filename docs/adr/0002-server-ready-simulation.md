# Server-ready simulation, even in single player

The game simulation (movement, Clashes, Knockouts, Pickups, growth, Bots) is a pure, fixed-timestep, seeded-random module with no dependency on the DOM, rendering or audio. It takes inputs from each Top ("target direction + dash pressed") and produces game state. Bots produce the same inputs as the Player. The game is single player for now, but multiplayer is planned, and this shape lets the simulation move to an authoritative server without a rewrite. It also makes the simulation easy to unit test and replay.

## Consequences

- Physics runs on Rapier's cross-platform deterministic build (`@dimforge/rapier2d-deterministic-compat`), not a hand-written solver, so crowded Clashes resolve together and a fast Dash can't skip through a Top in one step. It gives identical results on every machine and runs in Node, so it still fits an authoritative server. Tops remain plain data and the source of truth: each step copies them into Rapier and back. Rapier only moves and bounces Tops; Clash, Burst and Credit rules stay ours. The cost is a larger download (the engine's WebAssembly is inlined, about 800 kB gzipped) and an async `initPhysics()` before the first step.
- Rendering only reads state and never changes it. Visual-only effects (sparks, trails, shatter) live on the rendering side.
