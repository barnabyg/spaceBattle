# Weapon range information (#73)

The orders panel lists each own-ship weapon by its section and mount. Each launcher has a
separate entry for each missile design it can draw from the magazines. The selected contact's
separation appears above the list. The list exposes no enemy weapons or design information.

`WeaponsObservation.targetRange` is the full three-dimensional separation to the selected
weapons target, in metres, or `null` without a target. `WeaponsObservation.readiness` contains
each mount's effective or estimated range, independent `inRange` value and availability status.
Without a target, `inRange` is `null`; defensive entries also use `null` because they do not
claim an anti-ship range. Lost weapons remain listed.

Range uses the same simulation helpers as fire control. Beam effective range is the cutoff
for useful intensity, and kinetic effective range comes from the longest permitted flight.
Neither guarantees a hit or useful damage. Kinetic availability also checks the existing
interception solver. Holding fire, missing ammunition, lost integrity, heat limits and absent
power are distinct from range. Firing, charging and power describe the last simulation step;
`awaiting-step` makes no claim that a weapon will fire before the next step is evaluated.

Missile reach estimates one hour at boost speed with the existing guidance reserve. It is
conditional on target motion and manoeuvres, rather than a launch prohibition. A launcher may
launch beyond that estimate; hold fire does not cancel a separately ordered salvo. Point
defence and anti-missile missiles are labelled defensive, with interception reach rather than
an implied anti-ship range.

## Verification

Focused observation tests cover mixed ranges, three-dimensional separation, entering and
leaving range, no target, hold fire, ammunition, integrity, power, heat, interception failure,
missile reach/reloading and defensive identification. The ordinary-play Firefox check targets
a mixed battery, verifies independent range statuses, toggles hold fire and clears the target.
Existing weapons, kinetic and particle-beam Firefox checks also pass.

## Manual verification

With Node.js 24 or newer and desktop Firefox at 1920×1080 or larger, run this single command
from `C:/docs/git/spaceBattle` in PowerShell 7:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

In Shipyard, save a design with a laser and kinetic gun, including a magazine of slugs. Start
a player-controlled free battle using that design and select **Target enemy**. Under
**Weapons**, expect separation in km and individually identified mounts with different range
statuses where only one weapon reaches. Close through their boundaries, then open the range;
each status should follow independently. Pause and toggle **Hold fire**: range remains
visible and unchanged while the firing order changes. Choose **No target**: separation and
range comparisons should clear. Repeat with a missile design to inspect conditional reach
and launcher reloading, and a defensive design to confirm its weapons are identified as such.
