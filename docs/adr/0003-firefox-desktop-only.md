# Firefox on a desktop monitor only

The game supports one target: desktop Firefox on a 16:9 monitor of 1920×1080 or larger, with mouse and keyboard. Other browsers, mobile and touch are deliberately unsupported. Supporting only one platform lets the dense design and control menus use the whole screen. Rendering and browser features need testing on one browser only.

The UI was first laid out for 4K (3840×2160) alone. To run on a 1920×1080 machine, it now scales with the window instead: the root font size is the viewport width ÷ 160 (24 px at 3840, 12 px at 1920), and every layout size is in `rem`, so the same layout fills either screen. End-to-end tests run at 1920×1080.

## Consequences

- Layouts can assume a large 16:9 viewport and size everything in `rem`; there is no responsive reflow for small or differently shaped screens.
- Browser zoom does not enlarge the UI, because zooming also shrinks the viewport width that sets the font size.
- Browser features may be used if Firefox supports them, even where other browsers don't.
- Supporting another browser or other screen shapes later means revisiting the menu layouts, not just testing.
