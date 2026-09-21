# Clash model: Spin decides resistance, Impact decides damage

In a Clash, damage comes from Impact (how fast the two Tops close on each other), not from comparing their Spin. Both Tops lose Spin, and the Top with more Spin loses the smaller share. A Burst happens only when the Impact is large compared with the target's current Spin, so only a weakened Top can be Burst. We chose this so that a smaller Top that Dashes in well can beat a bigger one that's drifting, and so the leader doesn't snowball.

Each Top Type also has a Clash power that scales the Spin loss and Burst power it inflicts: Attack hits hardest, Stamina softest. So an Attack Top can still take more than a Stamina Top that has less Spin. The Spin split sets the baseline; Top Types bend it on purpose.

The Attacker (the Top driving in harder) is never Burst by its own attack. Otherwise a weakened Top that lands a finishing Dash on another weakened Top would Burst too, and the one who made the play would lose it. Because the Burst reward arrives in the same step, the Attacker survives the Spin it lost in that Clash. A dead-even head-on collision has no Attacker, so both can Burst and neither gets Credit.

## Considered Options

- **More Spin wins the Clash outright.** Rejected: it's deterministic, how you play doesn't matter, and the leader runs away with the game.
- **Burst is a random chance on hard hits** (as in the anime). Rejected: it feels unfair and would be hard to explain once multiplayer arrives.
- **A separate Burst gauge.** Rejected: it's effectively a second health bar, and Spin is meant to be the only health resource.
