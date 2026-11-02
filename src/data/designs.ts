import { parseDesign, type Design } from '../sim/design';
import bastion from './designs/bastion.json';
import lance from './designs/lance.json';
import needle from './designs/needle.json';
import pyre from './designs/pyre.json';
import quiver from './designs/quiver.json';
import sling from './designs/sling.json';
import torch from './designs/torch.json';

/** The hand-made designs that ship with the game. */
export const HAND_MADE_DESIGNS: readonly Design[] = [
  lance,
  bastion,
  sling,
  quiver,
  pyre,
  torch,
  needle,
].map(parseDesign);

export const handMadeDesign = (id: string): Design => {
  const design = HAND_MADE_DESIGNS.find((d) => d.id === id);
  if (!design) throw new Error(`No hand-made design "${id}"`);
  return design;
};
