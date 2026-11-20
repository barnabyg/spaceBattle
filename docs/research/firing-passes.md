# Firing passes (#114)

## What changed

Medium and high computer captains make firing passes when they must close and they are
short-ranged (reaching no further than 60,000 km) or outranged by half again. High captains make
them whenever they must close. A pass commits to a closing speed of three tenths of the delta-v
the ship has to spare above its reserve. The ship builds that speed straight at the enemy and
keeps its nose, and so its forward armour, on it. Its radiators stay in unless it runs hot. It
flies through the closest pass firing and never brakes inside the enemy's reach. Past the enemy,
it turns back nose first for another pass only while its spare delta-v covers stopping and
building the same speed again; otherwise it withdraws. With three tenths committed, that allows
two passes. Across a very large range disadvantage the existing attack run still builds speed
first; the pass takes over inside the ship's own reach.

A captain that outranges its enemy keeps holding just inside its own reach. There its beams
strip mounts and heat the enemy without burning ablative armour (#111). It backs away from a pass
rather than meet it.

## Measurements

Every pairing of hand-made designs with different reaches, in all four starting scenarios, seed 1,
medium captains on both sides (200 battles):

| Measure                                     | Before | After |
| ------------------------------------------- | -----: | ----: |
| Battles where the shorter-reach ship hits   |     64 |    64 |
| Battles the shorter-reach ship wins         |     36 |    36 |
| High beats low captain, Lance mirror (of 6) |      0 |     6 |

The high-skill captain's losses in the Lance mirror came from braking, engine section towards
the enemy, as it came into laser range (#106). Making passes, it never brakes under fire and wins
all six, so the skill batch test is back on the usual starts.

## Why short-ranged ships still cannot close

The pass does not change the outcomes for the Sling, Torch, Quiver and Pyre against beam ships,
and the reason is not tactical:

- The longer-ranged captain holds its range by backing away at the same acceleration, so the
  short-ranged ship closes at only 7–12 km/s.
- A laser burns ablative armour inside about half its reach. For the Torch's 8 cm of ablative
  forward armour to survive from the Lance's 50,000 km down to the Torch's own 18,700 km reach, it
  would have to close at about 52 km/s, nearly all of its 62 km/s of delta-v.
- The Sling, Quiver and Pyre carry 1.2 cm of heavy forward armour, which sheds only 0.38 MW/m².
  The Lance burns it from about 100,000 km.
- Every short-ranged stock design carries its weapons and sensor on the forward section, so
  losing that section disarms and blinds it.

What remains of #114 (short- and medium-range weapons landing hits in most of these battles, and
short-ranged ships sometimes beating long-ranged ones) needs a balance lever rather than
tactics. Two candidates: rolling to spread beam heat over the hull
([#112](https://github.com/barnabyg/spaceBattle/issues/112)), and stock designs suited to closing
under fire (ablative forward armour, weapons and sensors away from the nose).
