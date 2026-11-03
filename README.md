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

## Playing

On Windows, double-click `run.bat` in the repository root. It installs the dependencies on first run, then starts the game in Firefox; close its window to stop the game. From a terminal, `npm run dev` does the same once dependencies are installed.

The game opens on the main menu. Choose **Free battle**, pick a **Scenario** for where the ships start (an opening pass, head-on, crossing or pursuit, each a few hundred thousand km apart in empty deep space), a hand-made design for Blue and Red and whether the player or the computer commands each side, and for a computer side its **Captain skill**, then **Start battle**. When the battle ends, the result screen leads back to setup with the same choices.

A low-skill computer captain reconsiders its plan only every 20 seconds, does not dodge, leaves power and heat alone and always closes in; a medium one manages power and heat and keeps out of reach of an enemy it outranges; a high one also turns its best armour to the enemy and withdraws with some reserve to spare. Every computer captain knows the enemy only through its sensors, and withdraws once it has nothing left to fight with or reaches its reserve.

In battle, the time controls in the top bar pause the battle (or Space) and set its time compression with one button per speed, 1×, 10×, 100×, 500× and 1000× (or keys 1–5, and + / − to step between them); the chosen speed stays selected while paused. A significant event, such as a hit or a launch, drops time compression back to 1×.

You know the enemy only as a contact: its position and motion always, the rest only as far as your sensors make it out at the range. The tactical map labels the contact with what is made out (position only, silhouette, sections, mounts), and **Aim at** in the weapons orders offers each section and mount once it is made out; until then the weapons aim at the whole ship.

The tactical map's **Legend** shows how each layer is drawn and what it means, such as velocity, relative velocity, heading, trails and planned burns, with a switch to hide or show each one; the choices are kept for the browser session.

Each design holds back a **reserve** of delta-v; the status panel and the manoeuvre plan warn as the delta-v left comes down towards it. **Withdraw** (click twice to confirm) spends it to leave: the ship turns away and burns, and is gone once out of reach of every enemy weapon or after 30 minutes, a loss in which the ship survives. The enemy may keep firing but may not pursue: orders to close on, hold a range to or match velocity with a withdrawing ship are refused. A ship that runs out of propellant without withdrawing is stranded and lost.

In battle, the captain of a player side hears only what reaches their own hull, since there is no sound in vacuum: the drive's rumble while it burns, the ship's own guns, beams and launches, hits on the hull, and alarms for damage, overheating, an incoming missile and delta-v near the reserve. Enemy fire that misses makes no sound, and a battle between computer sides is silent. **Mute** (or M) and the volume slider in the top bar keep their settings for the browser session.

**Test mode**, for testing the game rather than playing it, is switched on with the **Test mode** switch on the main menu and is unavailable otherwise. With it on, free battle setup adds a **Seed** (blank for a new one each battle), a **Time limit** in hours (12 by default; a battle that reaches it ends with no result) and **Battles** for a batch run. A battle in test mode shows its seed, the enemy's full design and state (the instrument view draws it in full, whatever the sensors make out), and a test log of every event, and offers time compression up to 10000× and **Replay**: the same battle again from the same seed, with the player's orders given again at the same moments. **Run batch** fights the chosen designs against each other in the chosen scenario, the computer commanding both sides, without graphics and in parallel, then shows each side's wins, draws, no results, how sides lost and each battle's seed; enter a battle's seed with the computer commanding both sides to watch it again.

**Shipyard** on the main menu designs ships. Name the class, choose a hull size, add components from the catalogue, and set each section's armour, the propellant and the reserve. The shipyard places the components itself (the reactor buried in the middle, weapons spread over the sections, radiators along the middle's sides); choose a section for any component to place it there by hand, or **Place all automatically** to undo that. It shows each section's volume used, the mass, cost, delta-v and acceleration, anything that makes the design invalid, and a model of it. **Save design** keeps a valid design, as "<name> class", in the browser; free battle setup offers saved designs beside the hand-made ones. **Export** saves a design to a file to keep or share, and **Import design** reads one back, from this or an older version of the game.

**Campaign** on the main menu starts a campaign, or goes back to the one under way until the page is closed. It starts with 9,000,000 credits, enough for one modest frigate, and three ready-made designs (Lance, Sling and Quiver). The hub shows the credits, the **hangar** of ships owned, the designs to build (the campaign's own and any saved in the shipyard, which **Shipyard** opens) and the three **tiers** to fight: each sets the opponent's design budget and captain skill, and what a win pays. Choose a ship and **Fight tier** _n_ to fight an opponent of that tier, picked with the starting scenario by the campaign; a win pays the tier's reward and a loss pays nothing. A ship comes back from battle as the battle left it. Between battles each ship in the hangar shows what its damage costs to repair (half the price of new for what is wrecked) and its used propellant and ammunition to restock; **Repair** pays for the share of the damage set beside it, and **Restock** fills it up again. Damage not repaired, and anything not restocked, is still missing in the ship's next battle. **Refit** converts a ship to another design on the same hull size, paying for the components the new design adds plus labour (a fifth of all its components and armour); whatever comes out is scrapped for nothing, and what stays keeps its damage. **Sell** (click twice to confirm) pays a quarter of what the ship would cost new, less its repairs and restocking. A ship destroyed, stranded or forfeited is gone from the hangar; the credits stay. Only a ship able to fight (one the battle would not count lost at the start, with delta-v beyond its reserve) can be sent into battle. The campaign is over when no ship can fight, none can be put right with the credits and what selling the others would raise, and no design can be built with the credits and what selling every ship would raise; **New campaign** starts again.

## Layout

- `src/sim/` — the battle simulation: fixed time step, deterministic, SI units, no rendering or DOM (ADR-0001). Lint and a DOM-free type check enforce this. Computer captains command their sides here, through the same orders as the player.
- `src/game/` — headless glue around the simulation, such as the battle runner (pause and time compression) and test mode batch runs.
- `src/campaign/` — the campaign: actions in (build, fight, …), campaign state out. Headless.
- `src/shipyard/` — the shipyard: a specification in, a design out, with its volume, mass, cost and validation. Headless, like the simulation.
- `src/data/` — hand-made designs (JSON data files), scenarios, the shipyard's component catalogue, the campaign's opponents and the balance numbers (prices, tiers).
- `src/ui/` — the browser UI: menus in HTML/CSS, views in Three.js. It reads simulation state and gives orders; it never changes state directly.
- `e2e/` — Playwright tests in Firefox.
