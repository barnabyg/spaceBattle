import { parseDesign, type Design } from '../sim/design';
import type { ShipSpecification } from '../shipyard/shipyard';
import { catalogueComponent } from './components';
import bastion from './designs/bastion.json';
import bulwark from './designs/bulwark.json';
import lance from './designs/lance.json';
import needle from './designs/needle.json';
import pyre from './designs/pyre.json';
import quiver from './designs/quiver.json';
import rampart from './designs/rampart.json';
import rime from './designs/rime.json';
import sling from './designs/sling.json';
import torch from './designs/torch.json';
import ward from './designs/ward.json';

/** The hand-made designs that ship with the game. */
export const HAND_MADE_DESIGNS: readonly Design[] = [
  lance,
  bastion,
  sling,
  quiver,
  pyre,
  torch,
  needle,
  rampart,
  ward,
  rime,
  bulwark,
].map(parseDesign);

export const handMadeDesign = (id: string): Design => {
  const design = HAND_MADE_DESIGNS.find((d) => d.id === id);
  if (!design) throw new Error(`No hand-made design "${id}"`);
  return design;
};

/** What a new design starts from: a modest laser frigate, waiting for a name. */
export const NEW_SPECIFICATION: ShipSpecification = {
  name: '',
  hullSize: 'frigate',
  components: [
    'drive-light',
    'thrusters-light',
    'reactor-light',
    'capacitor-light',
    'sensor-4',
    'radiator-light',
    'radiator-light',
    'laser-500',
  ].map((id) => ({ component: catalogueComponent(id) })),
  armour: {
    forward: { type: 'ablative', thickness: 0.05 },
    middle: { type: 'ablative', thickness: 0.02 },
    engine: { type: 'ablative', thickness: 0.02 },
  },
  propellantMass: 400e3,
  reserve: 10e3,
};
