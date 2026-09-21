# beyblade.io (working title)

A browser .io game where spinning tops battle in a shared arena, knocking each other out to grow. Single player against bots for now; multiplayer planned.

## Language

### Combatants

**Top**:
A spinning combatant in the arena, whether controlled by the player or a bot.
_Avoid_: Beyblade, Blade, bey

**Player**:
The human controlling one Top.
_Avoid_: User, hero

**Bot**:
A Top controlled by the game rather than a human.
_Avoid_: AI, NPC, enemy

**Top Type**:
A Top's class, chosen at spawn: Attack, Defense or Stamina. It sets the Top's strengths and weaknesses.
_Avoid_: Class, kind, archetype

**Attack**:
A Top Type that is fast and dashes hard but loses Spin quickly.

**Defense**:
A Top Type that is heavy and hard to push but slow.

**Stamina**:
A Top Type that loses Spin slowly but hits weakly.

**Spawn Protection**:
A short time after spawning during which a Top cannot lose Spin or be Burst.
_Avoid_: Invincibility, shield, grace period

### Resources

**Spin**:
A Top's single health resource. It drains over time (faster for larger Tops), from Clashes and from Dashing, and a Top with zero Spin is out.
_Avoid_: HP, health, stamina, energy

**Max Spin**:
The most Spin a Top can hold. It grows with each Knockout the Top earns, and the Top's size and mass grow with it.
_Avoid_: Level, capacity

**Pickup**:
A small item scattered around the Arena that restores some Spin to the Top that collects it.
_Avoid_: Food, orb, pellet, powerup

### Actions

**Dash**:
A short burst of speed toward the cursor that costs Spin.
_Avoid_: Boost, charge, attack

**Clash**:
A collision between two Tops. Both Tops lose Spin, and the Top with more Spin loses the smaller share.
_Avoid_: Hit, attack, bump

**Impact**:
How hard a Clash is, measured by how fast the two Tops close on each other. It sets how much Spin is lost and whether a Burst happens.
_Avoid_: Force, damage, power

**Knockback**:
The push that separates two Tops after a Clash. Lighter Tops and Tops with less Spin are pushed further.

### Outcomes

**Knockout**:
Any way a Top is eliminated. Spin-out, Ring-out and Burst are all Knockouts. Knocking out another Top rewards Spin.
_Avoid_: Kill, death, elimination

**Spin-out**:
A Knockout where a Top's Spin reaches zero.

**Ring-out**:
A Knockout where a Top is pushed over the Rim.

**Burst**:
A Knockout where a single Clash destroys a Top outright, even though it still has Spin left. It happens only when the Impact is large compared with the target's current Spin, so only a weakened Top can be Burst.

**Credit**:
Who a Knockout is awarded to: the last Top to Clash with the victim shortly before it was knocked out. A Knockout can have no Credit.
_Avoid_: Kill credit, assist

### Places

**Arena**:
The single shared play area that all Tops occupy.
_Avoid_: Stadium, map, level, world

**Rim**:
The deadly circular edge of the Arena. A Top that crosses it is Rung out.
_Avoid_: Edge, wall, boundary
