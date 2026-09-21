# Server-ready simulation, even in single player

The game simulation (movement, Clashes, Knockouts, Pickups, growth, Bots) is a pure, fixed-timestep, seeded-random module with no dependency on the DOM, rendering or audio. It takes inputs from each Top ("target direction + dash pressed") and produces game state. Bots produce the same inputs as the Player. The game is single player for now, but multiplayer is planned, and this shape lets the simulation move to an authoritative server without a rewrite. It also makes the simulation easy to unit test and replay.

## Consequences

- Physics is written by hand (it's simple circle collisions) rather than using a physics library, so the simulation stays dependency-free and deterministic.
- Rendering only reads state and never changes it. Visual-only effects (sparks, trails, shatter) live on the rendering side.
