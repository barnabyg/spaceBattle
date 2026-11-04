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

Vitest's default is 15 s. Longer headless simulation tests retain their existing explicit
20–300 s limits, already several times their documented runtimes. The browser suite has a
20 min hard limit, nested within the CI job's 30 min limit. CI still stops at the first failure;
local runs report all failures, with no automatic retries.

These are test-runner changes; manual game verification does not apply. From the repository
root, run `npm.cmd run verify` to exercise every gate and confirm tests finish within their
safety limits.

## Playing

On Windows, double-click `run.bat` in the repository root. It installs the dependencies on first run, then starts the game in Firefox; close its window to stop the game. From a terminal, `npm run dev` does the same once dependencies are installed.

The game opens on the main menu. Choose **Free battle**, pick a **Scenario** for where the ships start (an opening pass, head-on, crossing or pursuit, each a few hundred thousand km apart in empty deep space), a hand-made design for Blue and Red and whether the player or the computer commands each side, and for a computer side its **Captain skill**, then **Start battle**. When the battle ends, the result screen leads back to setup with the same choices.

A low-skill computer captain reconsiders its plan only every 20 seconds, does not dodge, leaves power and heat alone and always closes in; a medium one manages power and heat and keeps out of reach of an enemy it outranges; a high one also turns its best armour to the enemy and withdraws with some reserve to spare. Every computer captain knows the enemy only through its sensors, and withdraws once it has nothing left to fight with or reaches its reserve.

In battle, the time controls in the top bar pause the battle (or Space) and set its time compression with one button per speed, 1×, 10×, 100×, 500× and 1000× (or keys 1–5, and + / − to step between them); the chosen speed stays selected while paused. A significant event, such as a hit or a launch, drops time compression back to 1×.

You know the enemy only as a contact: its position and motion always, the rest only as far as your sensors make it out at the range. The tactical map labels the contact with what is made out (position only, silhouette, sections, mounts), and **Aim at** in the weapons orders offers each section and mount once it is made out; until then the weapons aim at the whole ship.

The tactical map's **Legend** shows how each layer is drawn and what it means, such as velocity, relative velocity, heading, trails and planned burns, with a switch to hide or show each one; the choices are kept for the browser session.

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

Each design holds back a **reserve** of delta-v; the status panel and the manoeuvre plan warn as the delta-v left comes down towards it. **Withdraw** (click twice to confirm) spends it to leave: the ship turns away and burns, and is gone once out of reach of every enemy weapon or after 30 minutes, a loss in which the ship survives. The enemy may keep firing but may not pursue: orders to close on, hold a range to or match velocity with a withdrawing ship are refused. A ship that runs out of propellant without withdrawing is stranded and lost.

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
