import { describe, expect, it } from 'vitest';
import { catalogueComponent } from '../data/components';
import { HAND_MADE_DESIGNS } from '../data/designs';
import { SECTION_KINDS } from '../sim/design';
import {
  buildDesign,
  componentVolume,
  sectionVolume,
  specificationOf,
  type ShipSpecification,
} from './shipyard';

const part = (id: string) => ({ component: catalogueComponent(id) });

/** A modest laser frigate, much like the hand-made Lance. */
const laserFrigate: ShipSpecification = {
  name: 'Kestrel',
  hullSize: 'frigate',
  components: [
    part('drive-light'),
    part('thrusters-light'),
    part('reactor-light'),
    part('capacitor-light'),
    part('sensor-4'),
    part('radiator-light'),
    part('radiator-light'),
    part('laser-500'),
  ],
  armour: {
    forward: { type: 'ablative', thickness: 0.05 },
    middle: { type: 'ablative', thickness: 0.02 },
    engine: { type: 'ablative', thickness: 0.01 },
  },
  propellantMass: 400e3,
  reserve: 10e3,
};

describe('the shipyard', () => {
  it('builds a specification into a design whose components fit each section', () => {
    const { design, errors } = buildDesign(laserFrigate);
    expect(errors).toEqual([]);
    expect(design.name).toBe('Kestrel class');
    expect(design.hullSize).toBe('frigate');
    const placed = design.sections.flatMap((s) => [...s.components, ...s.mounts]);
    expect(placed).toHaveLength(laserFrigate.components.length);
    for (const kind of SECTION_KINDS) {
      const section = design.sections.find((s) => s.kind === kind);
      const used = [...(section?.components ?? []), ...(section?.mounts ?? [])].reduce(
        (total, c) => total + componentVolume(c),
        // Propellant tanks sit in the middle section, at 1 t/m³.
        kind === 'middle' ? laserFrigate.propellantMass / 1000 : 0,
      );
      expect(used).toBeLessThanOrEqual(sectionVolume('frigate', kind));
    }
  });

  it('buries the reactor in the middle, spreads weapons over the sections and puts radiators along the sides', () => {
    const { design, errors } = buildDesign({
      ...laserFrigate,
      components: [
        ...laserFrigate.components,
        part('laser-400'),
        part('laser-400'),
        part('point-defence'),
        part('magazine-rounds'),
      ],
    });
    expect(errors).toEqual([]);
    const section = (kind: string) => design.sections.find((s) => s.kind === kind);
    expect(section('middle')?.components.map((c) => c.type)).toContain('reactor');
    expect(section('engine')?.components.map((c) => c.type)).toContain('drive');
    expect(section('middle')?.mounts.filter((m) => m.type === 'radiator')).toHaveLength(2);
    for (const kind of SECTION_KINDS) {
      expect(section(kind)?.mounts.filter((m) => m.type === 'laser')).toHaveLength(1);
    }
  });

  describe('explains what is wrong with an invalid specification', () => {
    const without = (id: string) => ({
      ...laserFrigate,
      components: laserFrigate.components.filter((c) => c.component !== catalogueComponent(id)),
    });
    it.each([
      ['a blank name', { ...laserFrigate, name: '  ' }, 'Name the design.'],
      ['no drive', without('drive-light'), 'Needs a drive.'],
      ['no reactor', without('reactor-light'), 'Needs a reactor.'],
      ['no thrusters', without('thrusters-light'), 'Needs thrusters.'],
      [
        'two reactors',
        { ...laserFrigate, components: [...laserFrigate.components, part('reactor-light')] },
        'Has 2 reactors; a design takes exactly one.',
      ],
      [
        'more propellant than its tanks can hold',
        { ...laserFrigate, propellantMass: 3_000e3 },
        'Middle section is over its volume: 3,000 of 2,880 m³.',
      ],
      [
        'a gun without slugs',
        { ...laserFrigate, components: [...laserFrigate.components, part('kinetic-gun')] },
        'Kinetic guns need a magazine of slugs.',
      ],
      [
        'launchers without missiles',
        { ...laserFrigate, components: [...laserFrigate.components, part('launcher')] },
        'Launchers need a magazine of missiles.',
      ],
      [
        'point defence without rounds',
        { ...laserFrigate, components: [...laserFrigate.components, part('point-defence')] },
        'Point defence needs a magazine of rounds.',
      ],
      [
        'negative armour',
        {
          ...laserFrigate,
          armour: { ...laserFrigate.armour, engine: { type: 'heavy' as const, thickness: -0.01 } },
        },
        'Engine armour must be from 0 to 1,000 mm thick.',
      ],
      [
        'a reserve beyond the delta-v',
        { ...laserFrigate, propellantMass: 10e3 },
        /^The reserve of 10\.00 km\/s must be less than the delta-v of [\d.]+ km\/s\.$/,
      ],
    ] as const)('%s', (_, spec, message) => {
      const { errors } = buildDesign(spec);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(message);
    });
  });

  it('keeps a component where the player placed it, and the rest are placed around it', () => {
    const radiator = laserFrigate.components.findIndex((c) => c.component.type === 'radiator');
    const { design, errors, placement } = buildDesign({
      ...laserFrigate,
      components: laserFrigate.components.map((c, i) =>
        i === radiator ? { ...c, section: 'forward' as const } : c,
      ),
    });
    expect(errors).toEqual([]);
    expect(placement[radiator]).toBe('forward');
    const mountsOf = (kind: string) =>
      design.sections.find((s) => s.kind === kind)?.mounts.map((m) => m.type);
    expect(mountsOf('forward')).toContain('radiator');
    // The other radiator is still placed along the middle's sides.
    expect(mountsOf('middle')?.filter((type) => type === 'radiator')).toHaveLength(1);
  });

  it('checks components placed by hand against the volume of their section', () => {
    // Five 300 m³ lasers will not go into a frigate's 1,440 m³ forward section.
    const { errors, placement } = buildDesign({
      ...laserFrigate,
      components: [
        ...laserFrigate.components,
        ...Array.from({ length: 5 }, () => ({ ...part('laser-500'), section: 'forward' as const })),
      ],
    });
    expect(placement.slice(-5)).toEqual(Array(5).fill('forward'));
    // The sensor and capacitor that would go forward are placed elsewhere instead.
    expect(errors).toEqual(['Forward section is over its volume: 1,500 of 1,440 m³.']);
  });

  it('fits every hand-made design, rebuilt from its specification, within its hull', () => {
    for (const design of HAND_MADE_DESIGNS) {
      const { errors, design: rebuilt } = buildDesign(specificationOf(design));
      expect(errors, design.id).toEqual([]);
      expect(rebuilt.sections).toEqual(design.sections);
    }
  });

  it('gives the mass and cost of the hull, armour, propellant and every component together', () => {
    const result = buildDesign(laserFrigate);
    // 300 t of frigate structure, 214 t of components, 400 t of propellant, and ablative armour
    // 50, 20 and 10 mm thick over 1,104, 1,920 and 1,104 m² at 1,800 kg/m³.
    const armour = 99_360 + 69_120 + 19_872;
    expect(result.mass).toBeCloseTo(300e3 + 214e3 + 400e3 + armour, 3);
    // Structure 2 cr/kg; components at their prices per kg (drive 30, thrusters 15, reactor 40,
    // capacitor 20, sensor 60, radiators 10, laser 40); ablative armour 6; propellant 0.2.
    const components =
      80e3 * 30 + 20e3 * 15 + 40e3 * 40 + 10e3 * 20 + 4e3 * 60 + 2 * 15e3 * 10 + 30e3 * 40;
    expect(result.cost).toBeCloseTo(300e3 * 2 + components + armour * 6 + 400e3 * 0.2, 3);
  });
});
