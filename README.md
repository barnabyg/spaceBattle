# Space Battle

A real-time tactical game of long-range combat between large warships under known physics. See `GLOSSARY.md` for the game's vocabulary and `docs/adr/` for the decisions behind it.

Supported platform: desktop Firefox on a 4K monitor (ADR-0003).

## Commands

Run from the repository root after `npm ci` (and `npx playwright install firefox` once for end-to-end tests).

| Command             | What it does                                                                           |
| ------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`       | Starts the dev server and opens the game in Firefox.                                   |
| `npm run verify`    | Every check, in order: format, lint, type check, unit tests, audit, build, end-to-end. |
| `npm test`          | Unit tests (Vitest).                                                                   |
| `npm run e2e`       | End-to-end tests in Firefox (Playwright).                                              |
| `npm run typecheck` | Type checks the app, and the headless core without DOM types.                          |

## Layout

- `src/sim/` — the battle simulation: fixed time step, deterministic, SI units, no rendering or DOM (ADR-0001). Lint and a DOM-free type check enforce this. Computer captains command their sides here, through the same orders as the player.
- `src/game/` — headless glue around the simulation, such as the battle runner (pause and time compression).
- `src/data/` — hand-made designs (JSON data files) and scenarios.
- `src/ui/` — the browser UI: menus in HTML/CSS, views in Three.js. It reads simulation state and gives orders; it never changes state directly.
- `e2e/` — Playwright tests in Firefox.
