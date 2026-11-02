## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for barnabyg/spaceBattle via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Working in this repo

Commands and source layout are in `README.md`. `npm run verify` is the canonical check and must pass with no warnings.

- Keep every rule that affects a battle's outcome in `src/sim/`, behind `createBattle` (set up from designs, a scenario and a seed; give orders; advance; observe). Test there first, at that seam, through observations rather than internals.
- The simulation works in SI units (m, s, kg, W, J, K); the UI shows km and km/s.
- Use the glossary's terms in code, tests and UI text.
