# Space Battle

A real-time tactical game of long-range combat between large warships under known physics. See `GLOSSARY.md` for the game's vocabulary and `docs/adr/` for the decisions behind it.

Supported platform: desktop Firefox on a 16:9 monitor of 1920×1080 or larger; the UI scales with the window (ADR-0003).

## Commands

Run from the repository root after `npm ci` (and `npx playwright install firefox` once for end-to-end tests).

| Command             | What it does                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`       | Starts the dev server and opens the game in Firefox.                                   |
| `npm run verify`    | Every check, in order: format, lint, type check, unit tests, audit, build, end-to-end. |
| `npm test`          | Unit tests (Vitest).                                                                   |
| `npm run e2e`       | End-to-end tests in Firefox (Playwright).                                              |
| `npm run typecheck` | Type checks the app, and the headless core without DOM types.                          |

`npm run audit` checks production dependencies first, then the full dependency tree. Both checks
fail on high or critical advisories. The full-tree check has one development-tooling exception for
picomatch, which expires on 18 December 2026 at 00:00 UTC. Remove it when a patched release is
available. [Exception configuration](audit-ci.json) · [GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)

## Test timeouts

Timeouts detect hangs; they are not runtime targets or performance assertions. Leave at least
three times the representative runtime under normal full-suite load, with additional margin
for random scenarios, software rendering and slower CI hosts. Assertions finish as soon as
their condition holds; a larger limit adds no delay to a passing test. If a timeout fires,
inspect progress and timings before changing it again.

Playwright's limits live in `e2e/timeouts.ts`: ordinary UI tests get 60 s and assertions 15 s;
simulation waits get 60 s inside 120 s tests. The campaign battle gets 10 min inside a 12 min
test, including setup and post-battle checks. Its previous 150 s limit was exceeded under
full-suite load despite isolated runs taking about 20 s; 10 min is a provisional safety margin,
not an established expected duration. The short 1 s campaign probe only controls how often
the test restores time compression after events; it is not the battle's deadline.

The campaign win/reward test fixes the new campaign's random seed so it consistently fights
the same opponent in the same scenario. It exercises real combat and payment; it does not
assume that spending all missiles in any random battle guarantees a quick win.
Restoring time compression uses the ordinary UI assertion limit for the click. If the result
dialog opens between the visibility check and that click, the test accepts the completed
battle rather than waiting behind its modal until the whole test expires.

Vitest's default is 15 s. Longer headless simulation tests have explicit 20–600 s limits,
several times their documented runtimes. Battles between beam-armed ships got about twice as long
when armour began shedding beams by glowing (#111), so the hand-made batches now allow 120 s, the
tier batches 600 s and the longest computer-captain battles 60 s, each at least three times their
runtime under full-suite load. The browser suite has a
20 min hard limit, nested within the CI job's 30 min limit. CI caches Playwright's Firefox between runs,
keyed by the Playwright version, after one slow runner spent 12 minutes downloading it and ran out of
time. CI still stops at the first failure;
local runs report all failures, with no automatic retries.

Tests run in parallel. Vitest runs files in parallel but the tests within a file one after
another, so long battles are split across files (`handMadeBatch1–6`, `rangeBalanceEvaluation1–4`)
to keep any one file from setting the suite's wall-clock time. Playwright runs every test in
parallel, whatever its file. CI runs the static checks, the browser suite and each of Vitest's two
projects (`batches`, the `*Batch*` files, and `unit`, the rest, about equal in work) as separate
parallel jobs, and keeps Vitest's results between runs so each starts its longest files first.
Run one project locally with `npm.cmd test -- --project batches`.

These are test-runner changes; manual game verification does not apply. From the repository
root, run `npm.cmd run verify` to exercise every gate and confirm tests finish within their
safety limits.

## Playing

The battle sidebar keeps separation, closing speed, delta-v (including reserve warnings),
temperature and incoming missiles visible. **Navigation** opens first; switch to **Weapons**
for targeting, missiles, shields and point defence, **Power** for priorities and radiators,
**Status** for detailed motion and ship figures, or **Damage** for component integrity and the
battle log. Test mode adds **Enemy** and **Log** tabs. Only the selected panel scrolls; entered
values and each panel's scroll position survive switching. Focus a tab and use Left/Right,
Home or End to switch with the keyboard. Withdrawal and refused-order messages stay visible.

The battle tells its story as it happens: short lines over the bottom of the instrument view, such
as "Our radiator lost (middle) — our heat will rise.", "Salvo of 2 missiles launched at us. Impact in
about 3 min 20 s." or "The enemy is now within reach of our weapons.", fade after six seconds, or
fifteen for those that need the captain (in bold). Lines about your ship, the enemy and the battle
are marked in different colours. Every event that slows time compression gets a line, and so does
each crossing into or out of reach of your weapons and of the enemy weapons your sensors have made
out. Of the enemy, a line names only what the sensors made out; anything else is "Enemy combat
damage." The **Damage** tab keeps the latest 40 lines, timed, under **Battle story**. To check, start a
free battle as Bastion against a computer Lance and **Advance until** **Enemy in our reach**: "The
enemy is now within reach of our weapons." should appear over the instrument view and stay in the
**Damage** tab.

**Damage control**: in the **Damage** tab, each damaged component that a field repair can help has a
**Repair** button. The crew then restore it at 0.2% integrity a second up to 75%, one component at a
time; the row shows "repairing", or "repair paused under fire" for 30 seconds after its section is
hit, and **Stop** calls them off. Wrecked components cannot be repaired in battle, and repairs between
campaign battles are unchanged. Medium and high computer captains repair the drive first, then the
sensor, thrusters, weapons, reactor and radiators. To check, start a free battle, let the enemy damage
your ship, then press **Repair** beside a damaged component and watch its integrity climb.

Below the **Incoming hits** schematic, **Incoming salvos** lists each enemy salvo aimed at your
ship while it is in flight (missiles launched within two minutes of each other count as one salvo):
how many of its missiles are left and their warhead, the time to impact at their present closing
speed (sooner while they still boost), when your point defence can engage, how many of your
anti-missile missiles are on their way, and how many have been shot down. Once none is left in
flight the entry reads "defeated" or how many struck you, for 30 seconds of battle time, then goes.
Hovering over or focusing an entry picks out its missiles on the tactical map. To check, start a free
battle as Lance against a computer Quiver and **Advance until** **Next missile launch**: the salvo
should appear and count down, faster at higher time compression.

The right sidebar's **Incoming hits** schematic stays visible above every tab. Its forward,
middle and engine sections turn red and show **Hit** for 1.5 real seconds when struck,
including hits on their mounts and sections exposed to nuclear bursts. Repeated hits renew
the indication. This works even when sensors cannot resolve the enemy weapon or time
compression skips past the shot's animation. It shows recent strikes, rather than remaining
armour or integrity; the **Damage** tab provides those details. Pulses fade while paused too.

To check manually, run this command in PowerShell 7 from `C:/docs/git/spaceBattle`:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

Start a free battle against the computer, close to weapon range and let it fire on you.
Watch the schematic while switching between **Navigation**, **Weapons** and **Damage**.
The struck section should turn red briefly and show **Hit**, matching the incoming hit's
section in the battle log. At high time compression the pulse should still be readable.

For a manual check, run this command in PowerShell 7 from `C:/docs/git/spaceBattle`:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

Open the game in Firefox at 1920×1080 or larger and start a free battle as **Rime**. Pause,
enter a range in **Navigation**, switch through the tabs and scroll **Weapons**: essential
status, the tabs and the top-bar actions should stay visible. Return to **Navigation** and
check the range is retained. In **Power**, change a priority, order a burn in **Navigation**
and resume; the supply bars should update. Check **Weapons** for working shield controls,
then start as **Lance** and check those controls are absent.

Battle power controls show a supply bar for each system and a priority selector (1 is first).
Equipment absent from the design has no controls, status row or power row. Fitted equipment
remains visible when damaged, destroyed or depleted, so its loss can still be understood.
Incoming munition readouts remain available on every design. To check, start with **Lance**:
there should be no shields, missile launch or point defence controls. Start another battle
with **Rime** to see shields, **Bulwark** for anti-missile missiles or **Rampart** for point defence.
Selecting a priority moves that system and shifts the others. Systems before **Capacitors** can
use stored energy; systems after it rely on reactor power. Bars show the previous simulation
step's supply against demand, with exact power and percentage or **No demand** alongside them.
To check, launch using the manual withdrawal command below, pause a free battle, move **Drive**
to first and **Capacitors** to second, then order a burn and resume. Priorities stay selected;
the drive's bar and power figures update as the battle advances.

With **Fire freely** and a target in range, lasers fire a continuous beam at their listed beam
power, drawing their electrical input for as long as they fire; low power, heat and damage limit
output, and **Hold fire**, no target or leaving range stop it on the next step. Particle beams fire
continuously too.

Armour sheds a beam by glowing. Struck armour heats until it radiates away what lands on it, up to
its glow temperature: about 3,000 K for ablative armour, which sheds up to 4.1 MW/m², and 1,700 K
for heavy armour, which sheds only 0.38 MW/m². A laser below that only heats the struck section,
which glows and cools again over about 20 seconds once the beam is off, and a quarter of what it
sheds soaks into the ship's heat for its radiators; mounts, outside the armour, still take the whole
beam. Above it, only the excess burns the armour away. A beam lands at about 1 MW/m² at the edge
of its reach and four times that at half reach, so against ablative armour it only heats the ship
and strips its mounts from beyond about half its reach, and burns through closer in. Particle beams
heat armour through its depth, but it still sheds them by radiating from its surface. Computer
captains that cannot outrange the enemy close to 0.3 of their reach to burn through. See the
[armour glow notes](docs/research/armour-glow.md).

In the instrument view, struck armour glows where the beam last landed, in a black body's colours:
a dull red at about 700 K, through orange, to white-hot at its 3,000 K limit. It builds while the beam
is on and fades over about a minute once it is off, following the armour's surface temperature,
and stays distinct from weapon discharges, which glow in their beams' cool blues. A contact glows
the same way at each section the sensors make out; before they make out any, its hottest spot shows
as a glow over the whole ship, as a hot spot shows to any sensor. To check, start a free battle as
Bastion against a computer Lance in **Head-on**, target the enemy, select **Fire freely** and
advance until the enemy is within your reach: the Lance should glow orange where your laser lands,
and keep glowing, fading, for a while after **Hold fire**.

**Roll** in the **Navigation** tab turns the ship slowly about its long axis, so an enemy beam
sweeps round the struck section instead of boring into one patch: each patch is lit only for the
share of each turn the beam spot covers, about its width over the section's 48 m (frigate) or
80 m (cruiser) girth, so the armour wears and glows that much less. It helps most close in, where
the spot is a few metres across, and not at all once the spot is as wide as the ship. Rolling keeps
the nose, the drive and any manoeuvre as they are, but the ship's own beam weapons fire at half
power, their mounts facing the target only part of each turn. It is refused while the thrusters are
wrecked. Medium and high computer captains roll under beam fire they cannot yet answer, and stop
once within their own reach. To check it, start a free battle as Torch against a computer Lance,
order **Close** and select **Roll** once the Lance's laser starts landing: in test mode the **Enemy**
tab's view of your ship, or your **Damage** tab, should show the forward armour wearing far more
slowly than without rolling.

A slug or kinetic missile that gets past the armour wrecks what it hits by shock. Its energy
arrives in microseconds and tears machinery apart without melting it, so 100 kJ per kilogram
wrecks a component or a section's structure, where a beam needs 1 MJ per kilogram. A computer
captain whose armour is half worn on an attack run or firing pass presses on if it will reach its
own weapons' range within 30 minutes. A withdrawal would keep it under fire that long anyway.
Further out, it withdraws as before. To check it, start a free battle in **Head-on** with both
sides computer captains, a Sling against a Lance, and raise time compression. The Sling should take
laser fire for hours on the way in, then disable or destroy the Lance within a few slugs once
inside about 600 km.

To check manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }` from
`C:/docs/git/spaceBattle` in PowerShell 7. Switch on **Test mode**, then start a free battle with
Blue's Bastion as the player and Red's Lance as the computer in **Head-on**. Target the enemy,
select **Fire freely** and raise time compression. Once your long-range laser is in range it should
show **Firing in last step** continuously, and the **Enemy** tab should show the Lance's armour
unworn while the **Test log** records your hits. As the Lance closes inside about 80,000 km, its
forward armour should start wearing away.

Radiators take five simulated seconds to deploy (five seconds at 1×). Their status shows the
remaining time and the instrument view animates the panels extending. Cooling and exposure
stay at the folded level until deployment finishes.
Pausing freezes deployment and time compression speeds it up. **Retract radiators** acts
immediately and cancels a deployment in progress.

To check manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }` from
`C:/docs/git/spaceBattle` in PowerShell 7. Start a free battle, pause, and select **Deploy
radiators**: the status should stay at **Deploying · 5.0 s**. Resume at 1× and watch the
panels extend as the countdown finishes after five seconds. Pause midway: both the panels and
countdown should freeze. Retract, deploy again at 10×, and expect completion in
about half a second. Pause and start another deployment, then retract to cancel it.

On Windows, double-click `run.bat` in the repository root. It installs the dependencies on first run, then starts the game in Firefox; close its window to stop the game. From a terminal, `npm run dev` does the same once dependencies are installed.

The game opens on the main menu. Choose **Free battle**, pick a **Scenario** for where the ships start (an opening pass, head-on, crossing or pursuit, in empty deep space, starting just out of reach: 1.3 times the longest reach of either ship's weapons apart, never closer than 40,000 km and never further than 300,000 km; setup shows the separation for the chosen designs), a hand-made design for Blue and Red and whether the player or the computer commands each side, and for a computer side its **Captain skill**, then **Start battle**. When the battle ends, the result screen leads back to setup with the same choices.

A low-skill computer captain reconsiders its plan only every 20 seconds, does not dodge, leaves power and heat alone and always closes in; a medium one manages power and heat and keeps out of reach of an enemy it outranges; a high one also turns its best armour to the enemy and withdraws with some reserve to spare. Every computer captain knows the enemy only through its sensors, and withdraws once it has nothing left to fight with or reaches its reserve.

Medium and high captains whose weapons reach no further than 60,000 km, or that are outranged
by half again, make firing passes when they must close: they build closing speed straight at the
enemy (three tenths of the delta-v they have to spare), keep their nose and radiators in, fly
through the closest pass firing without braking, and turn back nose first for another pass only
while their spare delta-v covers stopping and building the same speed again; otherwise they
withdraw. A high captain makes passes whenever it must close, rather than brake with its engine
section towards the enemy. A captain that outranges its enemy holds just inside its own reach,
where its beams strip mounts and heat the enemy, and backs away from a pass rather than meet it.

Medium and high captains prioritise the drive on approach. When they identify a
beam that outranges them, they can build speed for a fast pass before entering its
reach. They withdraw if a severely outranged approach would leave them exposed
for too long while they can still escape, or if a damaged sensor or drive is
likely to fail before they can return fire. Gunboats can start a fast approach
before identifying enemy weapons. Firing competes with drive power for a ship
trying to keep its distance, and a ship can still be disabled during withdrawal.

Standard frigate lasers reach about 92,000–103,000 km. Needle's neutral particle
beam reaches about 116,000 km. The shipyard's 500 MW long-range laser reaches
about 165,000 km, needs a cruiser or battleship hull, and takes more power to
charge than the standard 500 MW laser. See the
[range-balance evaluation](docs/research/range-balance.md) for matchup results and
manual checks.

In battle, the time controls in the top bar pause the battle (or Space) and set its time compression with one button per speed, 1×, 10×, 100×, 500× and 1000× (or keys 1–5, and + / − to step between them); the chosen speed stays selected while paused. Time compression drops back to 1× only for what needs the captain: an armour breach, component loss or structural failure on your own ship, a missile launched at your ship when no other enemy missile is already flying at it, nuclear detonations, magazine explosions, withdrawal and battle end. Damage you do to the enemy, hits, impacts, interceptions, misses and further missiles of a salvo already under way preserve the selected speed; the hit indicator and battle log still report them. When the computer commands every side, damage to either ship drops time compression too. The time controls show the cause of an automatic slowdown until you choose a speed again.

**Advance until** beside the speeds runs the battle at the highest time compression until something happens, then pauses it: the enemy comes within reach of your weapons, you come within reach of an enemy weapon your sensors have made out, the separation reaches a distance you enter in km (closing or opening, whichever way the ships are going), the ships' closest pass, the next missile launch, or 10 minutes have passed. The battle pauses at the first step the condition holds and keeps the speed you had chosen before, and the time controls say why it paused. An event that needs the captain stops the advance early, at 1×, as above; choosing a speed or pausing cancels it. A condition that already holds, or a separation that is not above 0 km, is refused with a reason.

The closest pass is the battle's set piece. While the ships close, the essential status shows **Pass**: how long until they are closest if neither burns, and how far apart they will be then. When that separation is within reach of your weapons or an enemy weapon your sensors have made out, time compression drops to 10× ten minutes before the pass and to 1× a minute before it, once each per pass, naming the pass as the cause; an advance until the closest pass runs straight through to it. Once the ships draw apart, **Pass** shows the delta-v it takes to turn back for another pass at the same relative speed (twice that speed) against the delta-v left above your reserve.

To check it manually, use the launch command above and start a free battle as Lance against a
computer Bastion in **Crossing**. Note **Pass** in the essential status, then choose 1000×. As the
pass comes within the Bastion's laser reach the battle should slow to 10× with
“Slowed to 10×: pass within weapon reach in 10 min 0 s, …”, then to 1× a minute out (unless
damage to your ship slows it first). After the pass, **Pass** should read
“Another: … of … above reserve”. **Advance until** **Closest pass** should pause just past the
closest approach.

To check it manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }` from
`C:/docs/git/spaceBattle` in PowerShell 7 and start a free battle with Lance against a computer
Bastion. Choose 10×, then **Advance until** **Separation (km)**, enter 250000 and press Enter.
The battle should run fast, then pause with “Paused at 250,000 km separation”, **Separation**
just under 250,000 km and 10× still selected. Choose **Enemy in our reach** and **Advance**: it
should pause as the Lance's laser comes into range (or stop earlier at 1× if the Bastion damages
your ship first).

You know the enemy only as a contact: its position and motion always, the rest only as far as your sensors make it out at the range. The tactical map labels the contact with what is made out (position only, silhouette, sections, mounts), and **Aim at** in the weapons orders offers each section and mount once it is made out; until then the weapons aim at the whole ship.

The tactical map's **Legend** shows how each layer is drawn and what it means, such as velocity, relative velocity, heading, trails and planned burns, with a switch to hide or show each one; the choices are kept for the browser session. **Trail**, **Drop lines**, **Projected path** and **Planned burns** start off by default; saved session choices take precedence.

To check the defaults manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }`
from `C:/docs/git/spaceBattle` in PowerShell 7. Open a fresh Firefox browser session, start a
free battle and open **Legend**. Those four layers should be unchecked and the others checked.
Enable **Trail** and **Planned burns**, pause and order **Hold** at 150,000 km: planned burn
labels should appear. Disable **Planned burns** to hide them. Reload and start another battle;
the changed layer choices should be retained.

Beam arrows show the direction of fire without source-to-target text above them. Accessible
descriptions still name the firing ship, beam kind and target. To check, launch with
`npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }` from `C:/docs/git/spaceBattle` in
PowerShell 7. Start a free battle, target the enemy, select **Fire freely** and **Close**.
Once the ships exchange laser fire, check the tactical map: arrows should point from each
firing ship towards its target without a “Blue → Red” label. Toggle **Beams** in **Legend**
to hide and restore the beams and arrows together.

The map's **Separation** readout names the followed contact (the weapons target, or the first
contact otherwise) and shows its full three-dimensional distance in km. It stays readable while
zooming and rotating, holds steady while paused, and reads **No contact** if none is observed.
To check it manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }` from
`C:/docs/git/spaceBattle` in PowerShell 7, then start a free battle in Firefox. Watch separation
change, pause with Space, and zoom and rotate the map; the paused value should stay fixed.

Ship positions have a thick circle (own ship) or diamond (contact) and a white centre. Thin,
open arrowheads show motion from those positions and keep their size when zooming. The initial
view fits both observed positions with room for labels; after that, zoom and rotation are yours.
Labels stay beside the position symbols and separate when the symbols overlap. For a manual check, use the
same launch command above, pause a free battle, and toggle **Velocity** and **Relative velocity**
in the legend. Zoom and rotate, comparing heading with motion: the circle and diamond should
remain identifiable independently of the arrow tips.
The [map position review](docs/research/map-positions.png) shows both symbols and their motion arrows.

Each design holds back a **reserve** of delta-v; the status panel and the manoeuvre plan warn as the delta-v left comes down towards it. **Withdraw** in the top bar beside **End battle** (click twice to confirm; moving focus away cancels confirmation) spends it to leave: the ship turns away and burns, and is gone once out of reach of every enemy weapon or after 30 minutes, a loss in which the ship survives. The enemy may keep firing but may not pursue: orders to close on, hold a range to or match velocity with a withdrawing ship are refused. A ship that runs out of propellant without withdrawing is stranded and lost.

To check withdrawal manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }`
from `C:/docs/git/spaceBattle` in PowerShell 7. Start a free battle in Firefox. Click **Withdraw**
in the top bar once, move focus to another control and check that confirmation cancels. Click
**Withdraw** twice to order withdrawal; the button disables and the ship leaves when safe.

In battle, the captain of a player side hears only what reaches their own hull, since there is no sound in vacuum: the drive's rumble while it burns, the ship's own guns, beams and launches, hits on the hull, and alarms for damage, overheating, an incoming missile and delta-v near the reserve. Enemy fire that misses makes no sound, and a battle between computer sides is silent. **Mute** (or M) and the volume slider in the top bar keep their settings for the browser session.

**Test mode**, for testing the game rather than playing it, is switched on with the **Test mode** switch on the main menu and is unavailable otherwise. With it on, free battle setup adds a **Seed** (blank for a new one each battle), a **Time limit** in hours (12 by default; a battle that reaches it ends with no result) and **Battles** for a batch run. A battle in test mode shows its seed, the enemy's full design and state (the instrument view draws it in full, whatever the sensors make out), and a test log of every event, and offers time compression up to 10000× and **Replay**: the same battle again from the same seed, with the player's orders given again at the same moments. **Run batch** fights the chosen designs against each other in the chosen scenario, the computer commanding both sides, without graphics and in parallel, then shows each side's wins, draws, no results, how sides lost and each battle's seed; enter a battle's seed with the computer commanding both sides to watch it again.

**Shipyard** on the main menu designs ships. Name the class, choose a hull size, add components from the catalogue, and set each section's armour, the propellant and the reserve. The shipyard places the components itself (the reactor buried in the middle, weapons spread over the sections, radiators along the middle's sides); choose a section for any component to place it there by hand, or **Place all automatically** to undo that. It shows each section's volume used, the mass, cost, delta-v and acceleration, anything that makes the design invalid, and a model of it. **Save design** keeps a valid design, as "<name> class", in the browser; free battle setup offers saved designs beside the hand-made ones. **Export** saves a design to a file to keep or share, and **Import design** reads one back, from this or an older version of the game.

**Campaign** on the main menu starts a campaign, or goes back to the one under way until the page is closed. Nothing is saved automatically: **Save campaign** on the hub saves it to a file, and **Load campaign** on the main menu carries it on from one, including files from older versions of the game. It starts with 9,000,000 credits, enough for one modest frigate, and three ready-made designs (Lance, Sling and Quiver). The hub shows the credits, the **hangar** of ships owned, the designs to build (the campaign's own and any saved in the shipyard, which **Shipyard** opens) and the three **tiers** to fight: each sets the opponent's design budget and captain skill, and what a win pays. Choose a ship and **Fight tier** _n_ to fight an opponent of that tier, picked with the starting scenario by the campaign; a win pays the tier's reward and a loss pays nothing. A ship comes back from battle as the battle left it. Between battles each ship in the hangar shows what its damage costs to repair (half the price of new for what is wrecked) and its used propellant and ammunition to restock; **Repair** pays for the share of the damage set beside it, and **Restock** fills it up again. Damage not repaired, and anything not restocked, is still missing in the ship's next battle. **Refit** converts a ship to another design on the same hull size, paying for the components the new design adds plus labour (a fifth of all its components and armour); whatever comes out is scrapped for nothing, and what stays keeps its damage. **Sell** (click twice to confirm) pays a quarter of what the ship would cost new, less its repairs and restocking. A ship destroyed, stranded or forfeited is gone from the hangar; the credits stay. Only a ship able to fight (one the battle would not count lost at the start, with delta-v beyond its reserve) can be sent into battle. The campaign is over when no ship can fight, none can be made able to fight (by restocking, the smallest repair of 1%, or both) with the credits and what selling the others would raise, and no design can be built with the credits and what selling every ship would raise; **New campaign** starts again.

Before each campaign battle an intelligence report shows what the ship's **intelligence components** learned about the enemy: a **long-range scanner** shows its whole design, and a **signal interceptor** cracks a random selection of facts about it (hull size, drive thrust, reactor, delta-v, each section's armour, weapons, missiles and shields), as many as its quality allows (3 of 10 for the basic one, 7 for the advanced). Without either the ship goes in blind. The computer's side gathers intelligence by the same rules. Both are in the shipyard's catalogue; a damaged one works less well, and a wrecked one not at all.

Ship models in the shipyard and instrument view share a faceted prow, armour housings and an exposed structural spine, with distinct proportions derived from their equipment: kinetic ships have broad blunt shoulders, neutral particle beam ships long forward spars, and shielded ships prominent central housings. Player designs follow the same approach as stock designs. Conduits, vents, aerials and manoeuvring nozzles sit around the larger structures. These exterior fittings add no armour, mass or components, and disappear with their section. Installed weapons, sensors and radiators remain visible and operate as before. The [visual reference notes](docs/research/ship-visual-references.md) explain the inspiration; the [design identity review](docs/research/ship-identities.md) records each stock design's direction and comparison screenshots for human review.

## Layout

- `src/sim/` — the battle simulation: fixed time step, deterministic, SI units, no rendering or DOM (ADR-0001). Lint and a DOM-free type check enforce this. Computer captains command their sides here, through the same orders as the player.
- `src/game/` — headless glue around the simulation, such as the battle runner (pause and time compression) and test mode batch runs.
- `src/campaign/` — the campaign: actions in (build, fight, …), campaign state out. Headless.
- `src/shipyard/` — the shipyard: a specification in, a design out, with its volume, mass, cost and validation. Headless, like the simulation.
- `src/data/` — hand-made designs (JSON data files), scenarios, the shipyard's component catalogue, the campaign's opponents and the balance numbers (prices, tiers).
- `src/ui/` — the browser UI: menus in HTML/CSS, views in Three.js. It reads simulation state and gives orders; it never changes state directly.
- `e2e/` — Playwright tests in Firefox.

To check time compression manually, run `npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }`
from `C:/docs/git/spaceBattle` in PowerShell 7. Start a free battle as **Bastion** against a
computer **Lance**, target the enemy, select **Fire freely** and **Close**, and choose 1000×.
Your long-range lasers should damage the enemy before it can reply without dropping time
compression; the **Incoming hits** schematic and battle log still report the hits. When the
enemy's fire damages your own ship, time compression should drop to 1× and show
“Slowed to 1×” naming your ship and the affected part. Choosing a speed should clear that
message. Against a computer **Quiver**, its first missile launch at you should drop to 1×,
and further launches while its missiles are still in flight should not.
