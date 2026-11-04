# Instrument effects

Weapon source cues follow actual discharges at the firing mount: cyan laser glow,
violet or blue particle discharge, white kinetic flash, pale yellow point defence,
and green missile launch flare. A cue does not mean the attack hit or damaged anything.
Enemy sources are shown only at mounts currently resolved by the observing sensors.
Effects use the ship's body frame and follow its orientation.

New exterior damage flashes orange for half a simulation second. A rust-coloured
outline remains around damaged sections or mounts after the flash fades; destroyed
parts disappear. This display follows armour, structure and exposed mount integrity,
and never reveals machinery behind armour. A newly resolved, previously damaged part
shows its existing outline without inventing a fresh hit. Beam landing glows show
energy arriving, independently of whether that energy damages anything.

## Manual verification

With Node.js/npm and Firefox installed, run this command in PowerShell 7 from
`C:/docs/git/spaceBattle`:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

Start free battles with player-controlled ships using laser, charged/neutral particle,
kinetic, missile and point defence weapons. Select Fire freely or launch a missile and
watch the instrument view. Expect a local source cue only when the weapon actually
fires, clearing during reloading or when fire is held. Turn and burn while firing;
the cue should stay at its mount. Observe contacts at different ranges: unresolved
mounts must not disclose firing locations. Repeat with Test mode to inspect both ships.

Let the enemy fire on your ship, then hold fire on both sides. Expect orange feedback
at the damaged section or mount, followed by a lasting outline. Subsequent hits update
the outline and flash again. At higher time compression the half-second flash can
pass between frames; the lasting outline still reflects the damage. Damage to hidden
internal components is not painted on the exterior. A completely deflected attack
must not produce an orange damage flash or outline.
