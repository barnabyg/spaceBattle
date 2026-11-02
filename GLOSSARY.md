# Space Battle

A real-time tactical game of long-range combat between large warships, played under known physics: nothing faster than light, no free energy, no defences beyond what physics allows. Players design their ships within a budget and fight a campaign of increasingly capable opponents.

## Ships and designs

**Design**:
A reusable blueprint for a ship: a hull plus the components placed in each of its sections.
_Avoid_: Blueprint, template, loadout

**Hull**:
The structure a design is built on; its size sets the ship's sections and how much volume each section can hold.
_Avoid_: Frame, chassis

**Hull size**:
The size of a hull, such as frigate, cruiser or battleship.
_Avoid_: Hull class, ship class

**Ship**:
A single built instance of a design, carrying its own state: damage, propellant, heat, ammunition, position and motion.
_Avoid_: Vessel, unit

**Section**:
One armoured structural part of a ship, such as the forward, middle or engine section, that holds components inside its armour. A hit lands on whatever the line of fire reaches first.
_Avoid_: Zone, facing, compartment

**Integrity**:
How much more damage a component or section can take. A component works less well as its integrity falls, and stops working at zero.
_Avoid_: Health, hit points, HP

**Mount**:
A place on the outside of a section for a component that must be exposed, such as a weapon, radiator, sensor or drive nozzle. It can be hit without breaking through the armour.
_Avoid_: Hardpoint, turret slot

**Component**:
Any installable part of a ship: reactor, capacitor, drive, thrusters, radiator, armour, shield, sensor, weapon or intelligence component.
_Avoid_: Module, part, system

**Hangar**:
The ships the player owns in a campaign. Only one of them fights in each battle.
_Avoid_: Fleet, roster

**Refit**:
Converting a ship to a different design on the same hull size. It costs the new components plus a labour charge, and any components removed are scrapped with nothing recovered.
_Avoid_: Upgrade, retrofit

## Power, propulsion and heat

**Reactor**:
The component that generates a ship's power.
_Avoid_: Power source, power plant, generator

**Capacitor**:
A component that stores power for later use.
_Avoid_: Battery, power store

**Drive**:
The main engine, fixed along the ship's long axis; it uses power and propellant to accelerate the ship.
_Avoid_: Thrust, engine, main thruster

**Thrusters**:
Small jets that rotate the ship; the ship must turn before its drive can push in a new direction.
_Avoid_: RCS, manoeuvring jets

**Propellant**:
The mass a drive expels to produce thrust; when it runs low, a ship must withdraw.
_Avoid_: Fuel, reaction mass

**Delta-v**:
The total change in velocity a ship can still achieve with its remaining propellant.

**Reserve**:
The delta-v a design holds back for withdrawal; it is chosen at design time.
_Avoid_: Bingo fuel, safety margin

**Heat**:
Waste energy produced by reactors, drives and weapons that builds up inside a ship; too much forces systems to throttle back or suffer damage.

**Radiator**:
A component that sheds heat into space; it sheds more when deployed but is then more exposed to damage.
_Avoid_: Heat sink, cooler

## Defence

**Armour**:
Passive, unpowered protection in a section that must be worn through before components inside are damaged.
_Avoid_: Hull points, plating

**Heavy armour**:
Dense armour that resists every kind of attack moderately well but weighs a lot.

**Ablative armour**:
Armour that boils away under heat, so it holds off lasers and particle beams very well but slugs punch through it easily.

**Shield**:
A powered component that counters specific kinds of attack using known physics. Each kind of shield works against some attacks and is useless against others.
_Avoid_: Force field, deflector

**Magnetic shield**:
A shield that projects a magnetic field to bend charged particle beams away from the ship; it has no effect on any other weapon.

**Coolant shield**:
A shield of pumped coolant channels beneath the armour that carries laser heat away from the point of impact into the ship's heat, for the radiators to shed.
_Avoid_: Heat shield, thermal shield

**Sensor**:
A component that observes other ships during a battle. Better sensors make out more of an enemy ship's shape and components from further away, and track its position more precisely.
_Avoid_: Radar, scanner

**Intelligence component**:
A component that reveals something about an enemy design before the battle. A ship without any goes in blind and learns about the enemy only through its sensors.
_Avoid_: Pre-battle component, recon

**Long-range scanner**:
An intelligence component that observes the enemy ship before the battle.

**Signal interceptor**:
An intelligence component that cracks enemy communications to learn some partial facts about the enemy design, such as its drive power.
_Avoid_: Codebreaker, SIGINT

**Contact**:
An enemy ship as one side perceives it. Its position and motion are always known, and its shape, sections, mounts and armour become clearer as range closes and intelligence comes in. What a captain can aim at grows with it: first the whole ship, then a section, then individual mounts.
_Avoid_: Blip, track, target

## Weapons

**Weapon**:
Any component that damages or destroys an enemy ship or munition.

**Laser**:
A weapon firing light at light speed, powered by the ship; its beam spreads with distance, so it weakens with range.

**Charged particle beam**:
A weapon firing a beam of charged particles at near light speed; it does heavy damage but spreads quickly, so it is short-ranged, and magnetic shields can bend it away.

**Neutral particle beam**:
A weapon firing a beam of uncharged particles; it stays tight over long range and ignores magnetic shields, but delivers less damage for the power it uses.

**Kinetic gun**:
A weapon that fires solid slugs accelerated electromagnetically; it needs power and ammunition, and its slugs are slow enough to dodge at long range.
_Avoid_: Railgun, coilgun, mass driver (as the class name)

**Slug**:
A solid round fired by a kinetic gun. It flies in a straight line, and the kinetic energy it carries into the target does the damage.
_Avoid_: Shell, bullet, projectile

**Missile**:
A self-propelled, guided munition with its own propellant, launched at enemy ships.
_Avoid_: Torpedo

**Launcher**:
A mounted component that fires missiles.
_Avoid_: Tube, missile bay

**Magazine**:
A component inside a section that stores ammunition; how much it holds is a design choice, and a hit on a full magazine can be catastrophic.
_Avoid_: Ammo store, munitions bay

**Ammunition**:
The missiles and kinetic gun slugs a ship carries, used up in battle and bought again between battles.
_Avoid_: Munitions, ordnance, ammo

**Kinetic warhead**:
A missile warhead that destroys its target by hitting it directly at speed.

**Nuclear warhead**:
A low-yield nuclear missile warhead that detonates near its target, damaging it with radiation and heat that weaken sharply with distance.
_Avoid_: Nuke

**Fragmentation warhead**:
The warhead of an anti-missile missile; it bursts into a cloud of fragments in the path of an incoming missile.

**Point defence**:
A short-range, rapid-fire gun that shoots down incoming missiles.
_Avoid_: PDC, CIWS, flak

**Anti-missile missile**:
A missile launched to intercept enemy missiles rather than ships.
_Avoid_: Interceptor, counter-missile

## Play

**Side**:
One of the opposing forces in a battle, commanded by either the player or the computer.
_Avoid_: Faction, team, player

**Captain**:
The role the commander of a side plays: they give orders to their ship rather than steering it directly.
_Avoid_: Pilot

**Order**:
An instruction from the captain, such as a heading, a burn, a range to hold, a target priority or a power allocation.
_Avoid_: Command

**Autopilot**:
The ship's own system that turns orders into rotations and burns.

**Time compression**:
Running the battle faster than real time; it drops back to normal speed automatically when significant events occur.
_Avoid_: Fast forward, speed-up

**Battle**:
A single engagement between sides. It has no time limit.
_Avoid_: Fight, match, encounter

**Tactical map**:
The captain's main working view of a battle: symbols and exact data showing positions, motion, projected paths, weapon ranges and munitions in flight.
_Avoid_: Radar screen, plot

**Instrument view**:
The view of the battle as the ship's telescopes and instruments see it. The player's own ship is shown in full; contacts are shown only in the detail the sensors can resolve.
_Avoid_: Cinematic view, camera view

**Withdrawal**:
A ship leaving a battle by spending its reserve. The enemy may keep firing while it leaves but may not pursue. Withdrawal counts as a loss, but the ship survives.
_Avoid_: Retreat, escape, disengage

**Destroyed**:
A ship that has suffered a reactor breach or structural failure of its middle section; the ship is lost.

**Reactor breach**:
The catastrophic failure of a reactor whose integrity has reached zero, destroying the ship.

**Structural failure**:
A section's own structure being broken through, so that the section and everything in it is lost.

**Forfeit**:
The player ending a battle early with the "End battle" option. It counts as a loss and the ship is treated as destroyed.
_Avoid_: Concede, surrender, quit

**Disabled**:
A ship with no working weapons or no working drive; it has lost the battle.

**Stranded**:
A ship that has used its reserve without withdrawing and run out of propellant; it has lost the battle and the ship is lost.

**Campaign**:
A run of battles in which the player earns credits and faces more capable opponents. It ends when the player can no longer field a ship able to fight.
_Avoid_: Career, story mode

**Tier**:
A level of opponent difficulty, combining the opponent's design budget with the skill of its computer captain. The player picks which tier to fight; higher tiers pay more.
_Avoid_: Level, rank, difficulty

**Free battle**:
A battle outside the campaign, between any two designs, with each side commanded by the player or the computer and no credits at stake.
_Avoid_: Skirmish, quick battle, test bench

**Test mode**:
A setting for testing the game itself rather than playing it. It adds things that don't belong in real play, such as a battle time limit and extra logging.
_Avoid_: Debug mode, test bench

**Credits**:
The money spent on designs, components and repairs, earned by winning battles.
_Avoid_: Budget, money, cash
