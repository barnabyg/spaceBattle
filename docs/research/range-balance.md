# Closing through a weapon-range disadvantage

Issue: [#95](https://github.com/barnabyg/spaceBattle/issues/95). Baseline:
`76793441b161bcd7275fc7140389d10d309a3ed8`.

## Approach

The shorter-ranged captain should cross the firing zone quickly; the longer-ranged
captain should keep distance while paying for its weapons and drive from the same
power supply. Stock weapons and designs remain unchanged. Range asymmetry remains
a design choice, including hard counters. This follows ADR-0002.

The old autopilot approach aims to stop at the ordered range. Its conservative
cruise speed and early braking are useful for a settled engagement, but poor for a
gunboat crossing hundreds of thousands of kilometres under beam fire.

Medium and high captains now use a rapid attack run when the enemy's known reach
exceeds their own useful reach by more than ten times. A gunboat also starts this
way against unresolved arms when separation exceeds ten times its own reach;
waiting for identification would waste much of its approach. Other designs retain
their conventional approach until such a disadvantage is actually known. A fully
resolved unarmed contact is not treated as an unknown threat.

The closing-speed target is half the delta-v above the reserve, fixed at the start
of that run. The captain cancels transverse relative velocity and burns at full
available thrust once aligned. This is a speed target, not a guarantee that half
the propellant will remain: enemy acceleration and course corrections also cost
delta-v. The existing reserve withdrawal rule remains in force. Normal manoeuvring
resumes within useful weapon reach, so a fast approach can overshoot. Dodging
incoming slugs still takes precedence.

The drive has priority until the ship reaches its own fighting range, with the
existing 5% range tolerance. Incoming missiles still give weapons priority for
defence. An outranging captain continues to favour weapons while firing; once
capacitors empty, that reduces available drive thrust. The underlying power
allocation already implemented this trade-off and needed no numerical changes.

A captain abandons an exposed attack run outside its own reach when an armoured
section has half its original armour left and an enemy threat is known or has hit
it. This retains some protection and reserve for withdrawal instead of waiting
for the drive to fail. Withdrawal remains dangerous: turning exposes different
armour and the enemy may continue firing. Low-skill captains retain their simpler
approach and existing reserve/ammunition withdrawal rules.

Ten times reach limits the new policy to a large disparity. Half expendable delta-v
provides a useful closing-speed budget without deliberately consuming the reserve;
half armour is a legible damage-based decision point. These are captain policies,
not changes to thrust, inertia, weapon propagation or damage physics.

## Kinetic fire and loadouts

The 20 s kinetic flight-time policy remains conservative. Increasing it alone
cannot fix the reported engagement: even the 1,000 s hard fire-control limit puts
Sling's guns at 30,000 km, far short of Lance's roughly 165,451 km laser reach.
Observed acceleration does not establish how hard an enemy could dodge later.
Adaptive long shots would need a separate ammunition-risk policy; no such
prediction or ammunition expenditure is added here.

Sling remains a close-range specialist. A captain can choose a fast pass, more
thrust, better protection, suitable shields, missiles, or an early withdrawal.
Turning armour towards the enemy also competes with pointing the fixed drive in
the desired direction. Free-battle setup now explains these trade-offs. Starting
scenarios and campaign opponent selection remain unchanged; neither guarantees a
contestable matchup. The damage indicator is independent of this change.

## Evaluation

All comparisons use `createBattle`, ordinary observations and captain orders.
Both sides are medium computer captains, each of the four starting scenarios is
used with seeds 1 and 7, and the test-mode limit is 12 simulated hours: 56 battles
per version. This is a deterministic regression sample, not a win-probability
estimate. Some geometry produces identical results for both seeds.

Each row below covers eight battles. Separation is sampled every 10 simulated
seconds; the closest-range band is the minimum and maximum of those per-battle
minima, rounded to km. Beam-hit ranges are recorded directly from hit events.
"Responded" means the side scored a hit/impact or launched a missile, not merely
that its magazine lost ammunition through damage.

| Blue / Red      | Baseline outcome                            | Revised outcome                | Closest range, baseline → revised (km) | Revised response / withdrawal ordered by Red |
| --------------- | ------------------------------------------- | ------------------------------ | -------------------------------------- | -------------------------------------------- |
| Lance / Sling   | Lance wins 8; Sling destroyed 8             | Lance wins 8; Sling disabled 8 | 134,640–134,746 → 141,692–141,802      | 0 / 8                                        |
| Lance / Lance   | Blue wins 4, Red wins 4                     | Same                           | 129,454–133,912 → same                 | 8 / 0                                        |
| Sling / Sling   | 8 draws, both disabled                      | Same                           | 442 → same                             | 8 / 0                                        |
| Lance / Quiver  | Lance wins 8; Quiver disabled 8             | Same                           | 126,325–127,667 → same                 | 0 / 6                                        |
| Quiver / Quiver | 8 draws, both destroyed                     | Same                           | 37,797–37,827 → same                   | 8 / 0                                        |
| Lance / Torch   | Lance wins 8; Torch disabled 6, destroyed 2 | Same                           | 108,981–114,193 → same                 | 0 / 0                                        |
| Lance / Needle  | Lance wins 8; Needle disabled 8             | Same                           | 150,749–150,753 → same                 | 8 / 0                                        |

Lance/Sling beam hits span 134,649–165,294 km before, 141,703–165,239 km after.
Lance/Lance hits span 129,461–165,392 km; Lance/Quiver 126,335–165,297 km;
Lance/Torch 108,984–165,302 km; Lance/Needle 150,757–185,441 km. The latter four
bands are unchanged. Matched gunboats fight below 600 km; matched missile ships
exchange launches and impacts while still roughly 38,000 km apart.

The important limitation is explicit: stock Sling still cannot contest a firing
Lance from these long starts, and none of those eight withdrawals completes before
disablement. Its revised loss preserves the ship for campaign repairs rather than
destroying it. More rapid closing alone also failed in the reported player-Lance
case; it is not a substitute for adequate protection or earlier intelligence.
Successful withdrawal is demonstrated separately with worn armour and an improved
sensor that identifies the threat before entering its reach. Campaign economics
and long-run fleet composition have not been rebalanced.

An early prototype also rushed unresolved beam opponents; Torch's destruction count
increased from two to five. Restricting that speculative approach to gunboats
restored the charged-beam control results above. No stock numbers were changed to
force a better outcome.

## Acceptance and reproduction

Regression coverage is in `src/sim/rangeBalance.test.ts`, at the agreed
`createBattle` observation boundary:

- In the reported opening-pass seed-1 battle, medium and high Sling captains exceed
  15 km/s closing speed and reach less than 200,000 km separation at 9,000 s, with
  drive priority and without withdrawing prematurely. The old medium captain was
  still about 208,757 km away then.
- Both order withdrawal before losing the drive, with delta-v above the reserve,
  when armour falls to the approach's damage limit. This checks the decision,
  without promising survival under continued enemy fire.
- A worn-armour ship identifying the threat outside its reach completes withdrawal
  and survives. Low skill retains its conventional approach. An unresolved contact
  does not trigger a speculative beam attack run.
- With the same full-throttle burn, firing Lance's laser empties stored energy and
  reduces drive supply and thrust compared with holding fire.
- All 56 evaluation battles reach a combat result within 12 hours; matched ships
  on both sides respond, and all eight outranged Sling captains order withdrawal.
  Existing captain tests retain close-range slug impacts, missile defence, armour
  presentation, all skill levels and reserve withdrawal coverage.

To print the evaluation records from the repository root in PowerShell 7:

```powershell
$env:RANGE_REPORT = '1'; try { npm.cmd test -- src/sim/rangeBalance.test.ts --silent=false } finally { Remove-Item Env:RANGE_REPORT }
```

For manual verification, run this single preparation/launch command from
`C:/docs/git/spaceBattle` in PowerShell 7:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev -- --port 5279 --strictPort }
```

Use Firefox at 1920×1080 or larger at <http://localhost:5279>. Enable Test mode;
choose opening pass, seed 1, Blue Lance (Player), Red Sling (Computer, Medium).
Target Red, select **Fire freely**, deploy radiators and order **Close** to
100,000 km. At high time compression, inspect **Enemy**: Sling should build
closing speed, prioritise its drive and eventually declare withdrawal after armour
wear. It can still be disabled while leaving; no long-range slug shots are expected.
Repeat with High and compare Low's slower conventional approach.

For the power trade-off, during a firing opportunity choose **Navigation**, set
**Throttle %** to 100 and **Duration s** to 300, and select **Burn**. In **Power**,
rank Weapons before Drive. After stored energy empties, the drive's supply should
fall below demand. Select **Hold fire** in **Weapons**: drive supply recovers while
the burn continues, subject to heat and damage. This changes the motion orders, so
start a fresh battle to repeat the original approach comparison.
