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

## With rolling (#112)

Rolling about the long axis sweeps a beam round the struck section, so each patch is lit only for
the share of each turn the spot covers: its width over the section's girth, 48 m for a frigate.
Close in, where a laser spot is a few metres across, that cuts wear by five to ten times; at long
range, where the spot is as wide as the ship, it does nothing. Medium and high captains roll under
beam fire they cannot answer yet and stop within their own reach, where rolling would halve their
own beams. The same 200 battles, with rolling:

| Measure                                   | Before passes | Passes | Passes and rolling |
| ----------------------------------------- | ------------: | -----: | -----------------: |
| Battles where the shorter-reach ship hits |            64 |     64 |                 88 |
| Battles the shorter-reach ship wins       |            36 |     36 |                 40 |

The Torch now reaches its own range and hits every laser ship, though it still loses to them. The
Bulwark now beats the Needle in all four scenarios. The Sling, Quiver and Pyre still land nothing:
their 1.2 cm of heavy forward armour sheds only 0.38 MW/m², and a beam spot at the 50,000 to
100,000 km where it burns them is too wide for rolling to spread. Mean battle length hardly
changes (2.8 h to 2.9 h). What remains for #114 is in the stock designs: ablative noses and weapons
and sensors away from the forward section for the ships meant to close.

## Reworked short-range stock designs

The ships meant to close now carry what that needs:

- The Sling, Quiver and Pyre trade their 1.2 cm of heavy nose armour for 5.2 cm of ablative
  armour of the same mass, which sheds 4.1 MW/m² rather than 0.38. Each costs about 310,000
  credits more (ablative armour costs twice as much a kilogram); all three still fit the
  campaign's 9,000,000-credit start, with too little left for a second frigate.
- The Sling, Quiver, Pyre and Torch carry their sensor on the middle section, shadowed by the nose
  while it faces the enemy, so losing the nose no longer blinds them. Their weapons were already
  there. The Pyre keeps its nuclear magazine in the nose, away from the middle section, whose loss
  would destroy it.

Two tactical refinements come with them. A captain under beam fire it cannot answer rolls until
its own weapons can bite the enemy's armour, about half its beams' reach against ablative armour,
rather than stopping at its full reach, where its beams would only heat the enemy. And whether an
approach across a beam's reach is untenable now counts only the zone where the beam burns its
nose, and allows a ship that can roll four times as long under it.

The same 200 battles:

| Measure                                   | Before passes | Passes and rolling | Reworked designs |
| ----------------------------------------- | ------------: | -----------------: | ---------------: |
| Battles where the shorter-reach ship hits |            64 |                 88 |              124 |
| Battles the shorter-reach ship wins       |            36 |                 40 |               70 |

The shorter-reach ship now lands hits in most of these battles. The pure short-ranged Torch now
beats the Needle in all four scenarios, and the Lance and the Rampart in one each. The Quiver
beats the Lance, Needle, Rampart and Ward, and the Pyre the Needle and Rampart. Twelve Pyre
battles against the Lance, Ward and Rime are draws: its nuclear salvo disables the enemy as it
withdraws.

The Sling now closes to within about 1,000 km of a laser ship instead of withdrawing from
114,000 km, and lands slugs on the Needle and the Ward, but it still loses every battle: its guns
hold their slugs until they cannot be dodged, and it is out-shot at that range. Its kinetic guns
are a balance question of their own.
