import { describe, expect, it } from 'vitest';
import { handMadeDesign } from '../data/designs';
import { designSummary } from './designSummary';

const summaryOf = (id: string) => new Map(designSummary(handMadeDesign(id)));
const numberOf = (text: string | undefined) => Number((text ?? '').replace(/[^\d.]/g, ''));

describe('design summary', () => {
  it("shows a design's hull, mass, delta-v and laser reach", () => {
    const lance = summaryOf('lance');
    expect(lance.get('Hull size')).toBe('Frigate');
    expect(lance.get('Mass')).toMatch(/^[\d,.]+ t$/);
    expect(lance.get('Delta-v')).toMatch(/^[\d,.]+ km\/s$/);
    expect(lance.get('Lasers')).toMatch(/^1 · 500 MW beam · reach [\d,]+ km$/);
    expect(lance.get('Forward armour')).toBe('50 mm ablative');
  });

  it("shows a design's particle beams, the charged one far shorter-ranged than the neutral", () => {
    expect(summaryOf('lance').get('Charged particle beams')).toBe('None');
    expect(summaryOf('lance').get('Neutral particle beams')).toBe('None');
    const charged = summaryOf('torch').get('Charged particle beams');
    const neutral = summaryOf('needle').get('Neutral particle beams');
    expect(charged).toMatch(/^1 · 800 MW beam · reach [\d,]+ km$/);
    expect(neutral).toMatch(/^1 · 300 MW beam · reach [\d,]+ km$/);
    const reach = (text: string | undefined) => numberOf(text?.split('reach')[1]);
    expect(reach(neutral)).toBeGreaterThan(5 * reach(charged));
  });

  it("shows a design's kinetic guns and the slugs it carries", () => {
    expect(summaryOf('lance').get('Kinetic guns')).toBe('None');
    expect(summaryOf('sling').get('Kinetic guns')).toBe(
      '2 · 30.00 km/s · 600 slugs · reach 30,000 km',
    );
  });

  it("shows a design's launchers and the missiles it carries", () => {
    expect(summaryOf('lance').get('Missiles')).toBe('None');
    expect(summaryOf('quiver').get('Missiles')).toMatch(
      /^2 launchers · 12 Spike · [\d.]+ km\/s · reach [\d,]+ km$/,
    );
    expect(summaryOf('pyre').get('Missiles')).toMatch(
      /^2 launchers · 8 Ember \(10 kt nuclear\) · [\d.]+ km\/s · reach [\d,]+ km$/,
    );
  });

  it("shows a design's point defence and the rounds it carries", () => {
    expect(summaryOf('lance').get('Point defence')).toBe('None');
    expect(summaryOf('rampart').get('Point defence')).toBe(
      '2 · 5.00 km/s · 40,000 rounds · reach 25 km',
    );
  });

  it("shows a design's shields: what they stop, where, and the power they draw", () => {
    expect(summaryOf('lance').get('Shields')).toBe('None');
    expect(summaryOf('ward').get('Shields')).toBe('Magnetic, protons to 18.7 GeV · draws 200 MW');
    expect(summaryOf('rime').get('Shields')).toBe(
      'Coolant, 300 MW forward, 300 MW engine · draws 60 MW',
    );
  });

  it('tells the nimble frigate from the heavier cruiser', () => {
    const lance = summaryOf('lance');
    const bastion = summaryOf('bastion');
    expect(bastion.get('Hull size')).toBe('Cruiser');
    expect(numberOf(bastion.get('Mass'))).toBeGreaterThan(numberOf(lance.get('Mass')));
    expect(numberOf(lance.get('Acceleration'))).toBeGreaterThan(
      numberOf(bastion.get('Acceleration')),
    );
  });
});
