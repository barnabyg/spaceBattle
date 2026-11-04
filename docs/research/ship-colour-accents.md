# Ship artwork colours (#81)

Battle models use the same per-side colour assignment as the tactical map, including when
the player commands Red. Hull markings and weapon/nozzle trim carry the accent; armour,
equipment detail, radiator heat and exhaust colours retain their normal appearance.
Each model owns its materials, so opposing ships can share a design without sharing paint.
Radiator deployment rebuilds the model with the same accent.

Contacts retain the sensor detail limit: position dots and unresolved silhouettes use the
side colour; resolved sections and mounts have coloured outlines around their normal materials.
The shipyard previews an unassigned design in neutral colours because it has no battle side.

## Manual verification

Prerequisites: Node.js 24 or newer and desktop Firefox at 1920×1080 or larger.
Run this single command in PowerShell 7 from `C:/docs/git/spaceBattle`:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

1. Enable **Test mode**, choose **Free battle**, and choose Lance for both sides. Start
   the battle and pause with Space. The same ship design should have blue trim and markings
   in Blue's instrument view and red trim and markings in Red's view, matching the map icons.
   Drag to orbit the own ship and check that its armour and equipment remain recognisable.
2. Deploy and retract radiators while paused. The own ship's accent should keep its colour.
3. Start another free battle with Red commanded by the player. Red's own ship should still
   have red accents and Blue's contact blue accents. Disable Test mode and repeat: contacts
   should keep their side colour as dots, silhouettes or resolved outlines without revealing
   extra geometry.
4. With the server still running, open
   [the stock comparison gallery](http://localhost:5173/docs/research/ship-identity-review.html?accents)
   and [the player/damage comparison gallery](http://localhost:5173/docs/research/ship-identity-review.html?custom&accents).
   Each design appears twice with matching blue/red swatches. Check readable accents while
   preserving silhouettes, mount details, deployed radiators and missing sections.
   Use the port printed by Vite if 5173 is already occupied.

## Rendering interface

`createShipModel(design, look, accent?)` accepts an optional CSS colour for per-instance
markings and trim. Pass it again when rebuilding; `updateShipModel` preserves the materials.
`createContactModel(accent?)` applies the same colour to disclosed contact imagery.
`createInstrumentView(sides, colours?)` takes colours in the same side order as
`createTacticalMap`; the battle screen supplies one shared list to both views.
Omitting the accent retains neutral design-preview colours.
