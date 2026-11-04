# Shield feedback investigation (#72)

Baseline: `e56951d`, desktop Firefox at 1920×1080, player-controlled Blue **Rime**
against computer-controlled Red **Bastion**, ordinary free battle. The shield
controls start raised. Pause with Space, click **Shields down**, hover **Shields
up**, then click **Shields up**.

The existing three shield/toggle browser checks passed on this build. Lowering
and raising changes both the observation-backed status and `aria-pressed` while
paused. The selected button remains filled, bold and ticked under hover. The
reported unresponsive click could not be reproduced; the original browser/server
instance remains unknown. `run.bat` serves the current checkout and does not fetch
updates.

## Order trace

`createOrdersPanel` sends a `shields` order through `createBattleScreen` to
`battle.giveOrder`. The battle sets `shieldsRaised` synchronously. Each animation
frame observes that flag and updates the controls even when the runner is
paused. There is no pending shield order to wait for on resume.

Shield power is different: `ShieldsObservation.powered` describes the last
simulation step. Raising the order while paused does not recompute power or
protection. Advancing the battle settles power, with damage and available power
limiting the actual protection.

## Bounded checks

| Hypothesis                                     | Check                                                                                  | Result                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Orders wait for the next simulation step       | Click both controls while paused and inspect the status and pressed states             | Rejected: both update while paused                                                                                              |
| Hover hides the selection                      | Compare computed appearance and selection tick with the pointer on the other button    | Rejected: selected and hovered appearances differ                                                                               |
| Availability/protection feedback is incomplete | Check a ship without shields and inspect how damaged/unpowered shields are represented | Confirmed: absence was hidden and availability used installed count alone; nearby controls did not explain last-step protection |

The correction is limited to availability and protection feedback. Simulation
order handling and the existing selected-button styling are preserved.

Both missing-availability explanations were demonstrated red before correction:
the no-shield state was empty/hidden, and a ship whose shield had zero integrity
still displayed **Shields raised**. Both now explain unavailability and disable
the controls. Six focused Firefox checks pass, covering those cases, damaged
shields with no power, paused/running clicks, observed power after resuming and
the existing hover/accessible-selection regression. The paused check verifies
that the battle clock stays fixed while both controls are clicked, then verifies
that protection updates after resuming. No simulation code was changed.

## Manual verification

From `C:/docs/git/spaceBattle`, with Node.js 24 or newer, run:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

Use desktop Firefox at 1920×1080 or larger. Start **Free battle** with Blue
**Rime** commanded by **Player**. Leave the pointer on each shield control after
clicking it; exactly one available option should be ticked and selected, matching
the adjacent state. Pause with Space and repeat: the order applies immediately,
while the nearby explanation identifies protection as last-step information.
Resume to update shield power. Start another battle with **Lance** to check that
both controls are disabled with an explanation that no shields are installed.
