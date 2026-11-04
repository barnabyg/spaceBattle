# Charged laser balance (#77)

Lasers keep their existing design data, cost, electrical input, efficiency, focusing and effective
range. `beamPower` means sustained average output at full supply. A local buffer holds 15 seconds
of rated electrical input, scaled by mount integrity. It begins empty on every battle, including
campaign battles. No saved design or campaign format changes are needed.

At full supply, 15 seconds of charging precede a one-second shot at 16 times rated beam power.
Rated electrical input continues during the burst, so the buffer empties by the end. This keeps
the former average output and electrical consumption over complete 16-second cycles. A shot
contains at most 16 seconds of the old rated output. This is eight times the energy of the
initial two-second-cycle implementation, an explicit trade-off to preserve average damage with
the slower firing cadence. For Lance that is 8 GJ optical energy; for Bastion's two lasers
together, 12.8 GJ. The first shot and every subsequent shot use the same bounded buffer.
Full output needs continuous tracking through the burst; misses still miss.

Low allocated power extends charging and can exhaust the buffer before the burst ends. There
is no minimum reactor allocation needed to discharge already stored energy. Heat scales charging
and peak discharge; thermal cutoff, hold fire, no target and loss of range interrupt the burst.
Partial charge is retained, and target changes do not add or duplicate energy. Damage scales
charging power, buffer capacity and peak output. When reduced capacity displaces stored energy,
the next power settlement converts it to heat. Conversion losses are released during discharge;
the energy ledger counts actual emission and observations expose local stored electrical energy.

## Evidence and limits

`src/sim/chargedLasers.test.ts` checks timing, bounded storage, real power allocation, interruptions,
damaged/lost mounts, per-step energy accounting and equal cumulative energy and unshielded armour
wear to the old continuous model. The ordinary weapon tests retain diffraction, light travel,
thermal throttling and range checks. Existing deterministic battle/replay tests cover repeated runs.

The first-burst matrix uses Lance and Bastion attackers, intact Lance, Bastion and Bulwark defenders,
1,000 / 10,000 / 50,000 / 100,000 km, and seeds 1 / 7 / 42: 72 engagements. It checks actual emitted energy,
no battle outcome and surviving structure in every section after the whole first burst arrives.
This is a regression guard for representative armoured ships, not a promise that every design
survives every burst. Exposed mounts, unarmoured ships, already damaged ships and closer ranges
remain vulnerable. Multiple lasers can fire together; their individual buffers stay bounded.

Coolant shields remove a fixed power while a beam lands. With 16 times the instantaneous laser
power and one sixteenth the firing time, they absorb a smaller fraction of total energy. For the test
laser (400 MW average) against a 300 MW coolant shield, the shield removes about 4.69% during a
6.4 GW shot, compared with 75% of the old 400 MW continuous beam. The shield tests assert this
explicitly. Shielded designs and overall campaign win rates still need playtesting; matching
unshielded average damage alone does not establish complete game balance. No prices or shield
ratings have been changed in this initial implementation.

Browser verification: `e2e/chargedLasers.spec.ts` uses an imported long-reach laser design in a
normal player battle to check charging progress, firing, return to charging and hold fire. The
README provides the preparation/launch command and a stock-design manual scenario.
