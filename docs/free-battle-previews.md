# Free battle ship previews

Free battle planning shows a turning ship preview beneath each side's design selector. Both
previews use the shipyard's existing model renderer and show the selected hull and components.
Changing a selection replaces its preview immediately. An unavailable selection clears the
preview and design summary. Leaving planning releases both renderers and their animation loops.

## Manual verification

Prerequisites: Node.js 24 or later, npm and desktop Firefox, at a viewport of 1920×1080 or larger.
From the repository root (`C:/docs/git/spaceBattle`), run this command in PowerShell 7:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

1. Open **Free battle**. Expect both Blue and Red previews to be visible together with their
   design selectors, summaries and start controls.
2. Select **Bastion**, **Lance** and **Quiver** for Blue, then repeat for Red. Each image should
   change to the current design, with its distinctive proportions and equipment. Changing one
   side must leave the other selection unchanged.
3. Start the battle. Expect the instrument view's own ship to match the chosen player design.
   End the battle and return to setup; expect the same selections and working previews. Repeat
   twice to check navigation and renderer cleanup.
