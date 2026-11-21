# Kinetic guns at close range (#124)

## Why the Sling lost

After the firing-pass work (#114), the Sling reached within about 1,000 km of most beam ships but
never won. Tracing the head-on battle against the Lance (seed 1, medium captains on both sides)
showed it was not dodged slugs, too few hits or too little damage per hit. **It never fired:**

1. **It withdrew too late to escape.** The Lance's laser opens up at 103,000 km. The Sling builds
   an attack run to about 12.9 km/s closing, under fire for over two hours. At 21,000 km its 5.2 cm
   ablative nose was worn to half. The rule that keeps the last half of the armour for the way
   out then withdrew it, with 41 km/s of delta-v still in hand.
2. **The withdrawal achieved nothing.** It could not shed 12.9 km/s before the closest pass, so it
   coasted on towards the Lance under fire, braking. A withdrawal ends 30 minutes after the
   order, and this one ended about 1,000 km out. The Sling's guns fire only inside 600 km (30 km/s
   muzzle velocity × the 20 s before a slug can be dodged). So it withdrew, a loss, without
   firing a slug.

The same held against the Rampart, Ward and Rime. Against the Needle it did get into gun range
and landed 18 to 23 slugs per battle, but still lost.

3. **The slugs that landed did too little.** Each 5 kg slug arrives with about 4.9 GJ at the
   pass's closing speed. Past the armour, half goes to the struck component and half to the
   section's structure, wrecking at 1 MJ per kilogram, the figure for a beam, which has to melt
   what it destroys. An 80 t drive took about 33 slugs. With 40 s inside gun range per pass and
   one pass affordable, the Sling could never wreck enough.

## What changed

- **Pressing on (captain).** A computer captain whose armour is half worn on an attack run or
  firing pass withdraws only if its own weapons' reach is further off than 30 minutes at full
  thrust. Withdrawing then would keep it under fire just as long, so it presses on. Further out it
  withdraws as before.
- **Shock damage (physics).** Energy a slug or kinetic missile carries past the armour wrecks
  components and structure at 100 kJ/kg instead of 1 MJ/kg. A hypervelocity impact delivers its
  energy in microseconds, as a shock that spalls and fragments machinery without melting it.
  100 kJ/kg is still 2.5 times the 40 J/g specific energy at which an impact breaks up a whole
  satellite (the catastrophic-fragmentation threshold used in NASA's breakup models), since the
  shock spreads well beyond the part struck. Beam damage is unchanged.

## Attempts

| Hypothesis                                                       | Change                                                    | Result against the Lance                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| The firing pass gives up at half armour                          | Exempt passes from the half-armour withdrawal             | No change: it was on an attack run, not a pass                |
| Withdrawing from inside half an hour of its own reach is useless | Press on when its reach is nearer than a withdrawal's end | 16 slugs land, but the Lance survives and the Sling withdraws |
| Slugs past the armour do too little                              | Impact shock wrecks at 100 kJ/kg                          | The Lance is disabled after 4 slugs                           |

## Measurements

The 200-battle different-reach evaluation as in the [firing passes notes](firing-passes.md):
every pairing of hand-made designs with different reaches, in all four starting scenarios, seed 1,
medium captains on both sides. The baseline is main with damage control (#115) merged.

| Measure                                   | Before | After |
| ----------------------------------------- | -----: | ----: |
| Battles where the shorter-reach ship hits |    135 |   152 |
| Battles the shorter-reach ship wins       |     70 |    86 |
| Draws                                     |     12 |    12 |
| Sling wins (of 40)                        |      0 |    24 |

The Sling, by opponent (four scenarios each):

| Opponent | Before: wins, slugs landed | After: wins, slugs landed |
| -------- | -------------------------: | ------------------------: |
| Lance    |                       0, 0 |                     4, 18 |
| Needle   |                      0, 81 |                     4, 17 |
| Rampart  |                       0, 0 |                     4, 18 |
| Ward     |                       0, 8 |                     4, 20 |
| Rime     |                       0, 0 |                     4, 18 |
| Torch    |                      0, 34 |                      4, 4 |
| Bastion  |                       0, 0 |                     0, 39 |
| Quiver   |                       0, 0 |                      0, 0 |
| Pyre     |                       0, 0 |                      0, 0 |
| Bulwark  |                       0, 0 |                      0, 0 |

Only the Sling's 24 battles changed outcome. Every other matchup has the same winner. That
includes the Quiver and the Bulwark, whose kinetic missiles also gain the shock damage: they
already won or lost on whether their missiles got through, and a missile that gets through now
does more. The Bastion's cruiser hull outlasts 39 slugs. The missile ships and the Pyre stop the
Sling before it closes.

The outcomes are deterministic for one seed, so each matchup comes out the same way in all four
scenarios. The Sling now beats the beam frigates it can reach and loses to the cruiser and the
missile ships.
