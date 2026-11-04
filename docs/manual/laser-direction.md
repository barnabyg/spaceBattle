# Tactical map beam direction (#85)

With Node.js/npm and Firefox installed, run this single command in PowerShell 7 from
`C:/docs/git/spaceBattle`:

```powershell
npm.cmd ci; if ($LASTEXITCODE -eq 0) { npm.cmd run dev }
```

Start a free battle with laser-equipped designs on both sides. Use Test mode if you
want to give Fire freely orders to both sides. The tactical map shows double
chevrons pointing from the firing ship towards its target, with a source → target
label. Opposing attacks have separate direction markers. Enemy attacks appear when
the firing mount is resolved by your sensors. These cues indicate firing rather
than damage, so they can appear even when shields or a miss prevent damage.

Zoom and rotate the map, and let the ships move: the direction markers should
remain readable and point towards the intended target. Select Hold fire and expect
that ship's cue to disappear. Open Legend and switch Beams off and on: both lines
and direction markers should hide and return together. No battle rules change.
