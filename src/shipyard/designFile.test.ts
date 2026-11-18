import { describe, expect, it } from 'vitest';
import { catalogueComponent } from '../data/components';
import { handMadeDesign } from '../data/designs';
import type { Design, MountedComponentDesign } from '../sim/design';
import { withComponent } from '../sim/testing';
import { exportDesign, importDesign } from './designFile';
import { buildDesign } from './shipyard';

const heron = buildDesign({
  name: 'Heron',
  hullSize: 'frigate',
  components: [
    'drive-light',
    'thrusters-light',
    'reactor-light',
    'capacitor-light',
    'sensor-4',
    'radiator-light',
    'radiator-light',
    'charged-particle-beam',
    'kinetic-gun',
    'magazine-slugs',
  ].map((id) => ({ component: catalogueComponent(id) })),
  armour: {
    forward: { type: 'heavy', thickness: 0.03 },
    middle: { type: 'ablative', thickness: 0.02 },
    engine: { type: 'ablative', thickness: 0.01 },
  },
  propellantMass: 350e3,
  reserve: 8e3,
}).design;

describe('design files', () => {
  it('give an identical design when a design is exported and imported again', () => {
    expect(importDesign(exportDesign(heron))).toEqual(heron);
  });

  it('import a design in the first format, a bare design as the hand-made design files hold', () => {
    const legacyLance = withComponent(handMadeDesign('lance'), 'laser', { aperture: 4 });
    const imported = importDesign(JSON.stringify(legacyLance));
    expect(imported.name).toBe('Lance class');
    expect(imported.sections).toEqual(legacyLance.sections);
    expect(imported.propellantMass).toBe(400e3);
  });

  it('keeps the cruiser mount requirement on export and import', () => {
    const bastion = handMadeDesign('bastion');
    expect(importDesign(exportDesign(bastion)).sections).toEqual(bastion.sections);
    const frigate = withComponent(handMadeDesign('lance'), 'laser', { minimumHullSize: 'cruiser' });
    expect(() => importDesign(exportDesign(frigate))).toThrow(
      /laser needs a cruiser hull or larger/,
    );
  });

  it('refuse files that are not designs, or come from a newer version of the game', () => {
    expect(() => importDesign('not json')).toThrow('not a design file');
    expect(() => importDesign('{"format":"space-battle-campaign","version":1}')).toThrow(
      'not a design file',
    );
    expect(() =>
      importDesign(JSON.stringify({ format: 'space-battle-design', version: 99, design: {} })),
    ).toThrow('newer version');
  });

  it('refuse a design the shipyard would not build', () => {
    const laser = catalogueComponent('laser-500') as MountedComponentDesign;
    const cramped: Design = {
      ...heron,
      sections: heron.sections.map((s) =>
        s.kind === 'forward' ? { ...s, mounts: Array.from({ length: 6 }, () => laser) } : s,
      ),
    };
    expect(() => importDesign(exportDesign(cramped))).toThrow(/Forward section is over its volume/);
  });
});
