# Armour shedding lasers by glowing (#111)

## Why lasers fire continuously again

Issue [#111](https://github.com/barnabyg/spaceBattle/issues/111) set out to make long-range beam
fire wear a ship down rather than decide the battle on its own. The physical basis is that struck
armour heats until it radiates away what lands on it. A surface at temperature _T_ radiates
εσ*T*⁴, so armour that can glow at _T_ without wearing away sheds lasers up to that intensity.

With the charged lasers of #77, a laser fired one-second bursts at 16 times its rated power, so
even at the edge of its reach a burst landed at about 16 MW/m². No armour sheds that by glowing.
Heat conducted into the armour during a one-second pulse raises the threshold only to about
17 MW/m² for steel-like heavy armour (conductivity 40 W/m·K) and under 3 MW/m² for
carbon-phenolic. Under bursts, any glow rule would have changed little beyond the outer few
per cent of reach against heavy armour. Lasers therefore fire continuously again, at their rated
power, landing at about 1 MW/m² at the edge of their reach.

## The rule

| Armour   | Glow temperature | Emissivity | Radiative limit εσ*T*⁴ |
| -------- | ---------------: | ---------: | ---------------------: |
| Heavy    |          1,700 K |        0.8 |             0.38 MW/m² |
| Ablative |          3,000 K |        0.9 |              4.1 MW/m² |

Heavy armour holds until it nears melting. Carbon-phenolic chars to carbon, which glows
white-hot before it sublimes, as re-entry heat shields do.

While a section has armour left, a beam landing on it at intensity _I_ (after shields take their
share) is shed up to the radiative limit _L_. Only the excess, _I_ − _L_, burns the
armour, at (_I_ − _L_)/(ρ·_e_) metres per second. A quarter of what is shed soaks into the ship's
heat through the hull behind the hot spot (`GLOW_CONDUCTED_SHARE`); the rest radiates back into
space. The struck surface glows where εσ*T*⁴ = _I_, up to its glow temperature, and cools back
towards the ship's temperature with a 20-second time constant. Mounts sit outside the armour and
take the whole beam at any intensity. Particle beams deposit their energy through the armour's
depth rather than at its surface, but the armour can still only lose that heat by radiating from
its surface, so the same limit holds. A first version exempted them; the Needle's neutral particle
beam then won every one of its pairings, as it alone could still wear armour down from long range.

Laser intensity falls with the square of range, so against ablative armour a laser only heats
the ship and strips its mounts beyond about half its reach (√(1/4.1) ≈ 0.49), and burns through
closer in. Heavy armour cannot keep a laser off anywhere in its reach, but it is cheaper per metre
of protection against slugs. Computer captains that cannot outrange the enemy now close to 0.3 of
their own reach, where a laser lands at about 11 MW/m², instead of half their reach, which was
right at ablative armour's limit.

## Effect on battles

Every pair of different hand-made designs fought once head-on (seed 1), the computer commanding
both, starting just out of reach (#106). Before is `main` with charged lasers; after is this change.
All 55 battles still reach a result.

| Pairing          | Before (winner, h) | After (winner, h) |
| ---------------- | ------------------ | ----------------- |
| Lance / Bulwark  | Lance, 2.0         | Bulwark, 4.0      |
| Needle / Rampart | Needle, 2.3        | Rampart, 4.0      |
| Rampart / Rime   | Rampart, 2.1       | Rime, 3.3         |
| Ward / Bulwark   | Ward, 2.0          | Bulwark, 4.0      |

The other 51 keep their winner. Battles between beam-armed designs take about 1.5 to 2 times as
long (Lance / Bastion 2.4 h to 4.6 h): beyond about half reach the beams only heat the ships and
strip their mounts, and the armour starts wearing away once they close. Battles involving the
missile and kinetic designs (Sling, Quiver, Pyre) barely change. The computer captains still need
#114 to choose between wearing an enemy down from range and closing to burn it.

The balance tests still pass: every hand-made pairing reaches a result, tier 2 and 3 opponents beat
the tier below, and the high-skill captain beats the low-skill one from the 300,000 km start.
