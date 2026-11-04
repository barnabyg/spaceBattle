import { expect, it } from 'vitest';
import { formatKm } from './format';

it('formats separation from metres as grouped kilometres', () => {
  expect(formatKm(5_000_000)).toBe('5,000 km');
  expect(formatKm(0)).toBe('0 km');
  expect(formatKm(300_832_179)).toBe('300,832 km');
});
