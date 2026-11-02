# Firefox on a 4K desktop monitor only

The game supports one target: desktop Firefox on a 4K (3840×2160) monitor, with mouse and keyboard. Other browsers, smaller resolutions, mobile and touch are deliberately unsupported. Supporting only one platform lets the dense design and control menus use the whole screen. Rendering and browser features need testing on one browser only.

## Consequences

- Layouts can assume a large viewport; there is no responsive design for small screens.
- Browser features may be used if Firefox supports them, even where other browsers don't.
- Supporting another browser or smaller screens later means revisiting the menu layouts, not just testing.
