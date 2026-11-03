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

You know the enemy only as a contact: its position and motion always, the rest only as far as your sensors make it out at the range. The tactical map labels the contact with what is made out (position only, silhouette, sections, mounts), and **Aim at** in the weapons orders offers each section and mount once it is made out; until then the weapons aim at the whole ship.

Each design holds back a **reserve** of delta-v; the status panel and the manoeuvre plan warn as the delta-v left comes down towards it. **Withdraw** (click twice to confirm) spends it to leave: the ship turns away and burns, and is gone once out of reach of every enemy weapon or after 30 minutes, a loss in which the ship survives. The enemy may keep firing but may not pursue: orders to close on, hold a range to or match velocity with a withdrawing ship are refused. A ship that runs out of propellant without withdrawing is stranded and lost.

In battle, the captain of a player side hears only what reaches their own hull, since there is no sound in vacuum: the drive's rumble while it burns, the ship's own guns, beams and launches, hits on the hull, and alarms for damage, overheating, an incoming missile and delta-v near the reserve. Enemy fire that misses makes no sound, and a battle between computer sides is silent. **Mute** (or M) and the volume slider in the top bar keep their settings for the browser session.

**Test mode**, for testing the game rather than playing it, is switched on with the **Test mode** switch on the main menu and is unavailable otherwise. With it on, free battle setup adds a **Seed** (blank for a new one each battle), a **Time limit** in hours (12 by default; a battle that reaches it ends with no result) and **Battles** for a batch run. A battle in test mode shows its seed, the enemy's full design and state (the instrument view draws it in full, whatever the sensors make out), and a test log of every event, and offers time compression up to 10000× and **Replay**: the same battle again from the same seed, with the player's orders given again at the same moments. **Run batch** fights the chosen designs against each other in the chosen scenario, the computer commanding both sides, without graphics and in parallel, then shows each side's wins, draws, no results, how sides lost and each battle's seed; enter a battle's seed with the computer commanding both sides to watch it again.

## Layout

- `src/sim/` — the battle simulation: fixed time step, deterministic, SI units, no rendering or DOM (ADR-0001). Lint and a DOM-free type check enforce this. Computer captains command their sides here, through the same orders as the player.
- `src/game/` — headless glue around the simulation, such as the battle runner (pause and time compression) and test mode batch runs.
- `src/data/` — hand-made designs (JSON data files) and scenarios.
- `src/ui/` — the browser UI: menus in HTML/CSS, views in Three.js. It reads simulation state and gives orders; it never changes state directly.
- `e2e/` — Playwright tests in Firefox.
