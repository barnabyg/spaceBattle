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

  it("shows a design's kinetic guns and the slugs it carries", () => {
    expect(summaryOf('lance').get('Kinetic guns')).toBe('None');
    expect(summaryOf('sling').get('Kinetic guns')).toBe(
      '2 · 30.00 km/s · 600 slugs · reach 30,000 km',
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
