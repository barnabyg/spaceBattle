# Browser game with a headless, deterministic simulation core

The game is built in TypeScript (strict) for the browser, using Three.js for the 3D battle view and HTML/CSS for the design and control menus. The game is menu-heavy and graphically light, which suits the web better than a game engine's UI tooling. All game rules (physics, damage, heat, AI) live in a simulation core that knows nothing about rendering and advances in fixed time steps, always producing the same outcome from the same inputs. This makes time compression straightforward, lets computer-vs-computer battles run headless far faster than real time, and makes the rules testable without a browser.

## Considered options

- **Godot** or **Unity**: stronger 3D tooling, but neither suits detailed menu UIs as well as HTML does, and their rich graphics features buy little in a game with deliberately low graphical demands.

## Consequences

- The renderer only reads simulation state; it never changes it. Anything that affects the outcome of a battle belongs in the core.
- A desktop build, if wanted later, means wrapping the web app (for example with Tauri or Electron), not porting it.
