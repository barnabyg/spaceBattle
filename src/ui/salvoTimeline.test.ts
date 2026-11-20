import { describe, expect, it } from 'vitest';
import type { SalvoEntry } from '../game/salvos';
import { describeSalvo } from './salvoTimeline';

const salvo = (changes: Partial<SalvoEntry>): SalvoEntry => ({
  launched: 0,
  missiles: 4,
  inFlight: 3,
  ids: [1, 2, 3],
  warhead: 'nuclear',
  impactIn: 130,
  pointDefenceIn: 100,
  antiMissiles: 2,
  shotDown: 1,
  struck: 0,
  state: 'incoming',
  ...changes,
});

describe('salvo timeline text', () => {
  it('counts an incoming salvo down to impact and to the defences', () => {
    expect(describeSalvo(salvo({}))).toBe(
      '3 of 4 nuclear missiles · impact in 2 min 10 s · point defence in 1 min 40 s · 2 anti-missile missiles on the way · 1 shot down',
    );
    expect(describeSalvo(salvo({ pointDefenceIn: 0, antiMissiles: 0, shotDown: 0 }))).toBe(
      '3 of 4 nuclear missiles · impact in 2 min 10 s · within point defence',
    );
  });

  it('marks a salvo defeated, or what struck', () => {
    expect(describeSalvo(salvo({ state: 'defeated', inFlight: 0, shotDown: 4 }))).toBe(
      'Salvo of 4 nuclear missiles defeated · 4 shot down',
    );
    expect(describeSalvo(salvo({ state: 'struck', inFlight: 0, struck: 1, shotDown: 3 }))).toBe(
      'Salvo of 4: 1 struck us · 3 shot down',
    );
  });
});
