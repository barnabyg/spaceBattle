# Detailed contacts

With Test mode off, the instrument view uses the detailed ship model only while the observing
ship's working sensors resolve every surviving section and mount. Resolving one mount does not
qualify. The same diffraction and integrity rules govern aiming and this transition; there is
no fixed separation threshold. Losing resolution restores the appropriate plain contact model.
Destroyed parts stay absent. Full exterior detail reveals appearance, not interior equipment,
propellant or ammunition stores. Test mode continues to show full detail unconditionally.

The simulation supplies an explicit `fullyResolved` observation and a restricted exterior
descriptor while complete. The renderer never needs the enemy's private design or own-ship
observation for normal play. Both own ships and resolved contacts use the same mesh builder.

## Manual verification

Prerequisites: Node.js 24+, npm and desktop Firefox. From `C:/docs/git/spaceBattle`, run in
PowerShell 7:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

For normal play, leave Test mode off, choose Free battle, the Head-on scenario, Lance on both
sides, and Player on both sides. Leave weapons on Hold fire and manoeuvres unset, then select
1000× time compression. The ships drift nose-to-nose, pass, and separate. Watch the contact's
caption: it progresses through the partial stages to Full exterior detail only once the last
surviving mount resolves, then returns to a partial stage as separation grows. Pause to inspect
the detailed hull and mounts. Exact transition ranges depend on the design and working sensors.

For a short repeatable rendering check, open
[the transition review](research/resolved-contact-review.html) on the running server at
`/docs/research/resolved-contact-review.html`. It starts fully resolved in normal-play mode.
Advance twice: the contact becomes partial. Reset restores full detail. Toggle Test mode on
while partial: full detail returns; turning it off restores partial detail. The fixture uses
real `createBattle` observations and the ordinary instrument renderer.
