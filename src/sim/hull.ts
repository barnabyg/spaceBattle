import type { HullSize, SectionKind } from './design';

/** The size of one section of a hull, in metres. */
export interface SectionShape {
  readonly kind: SectionKind;
  /** Along the ship's long axis. */
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

export interface Hull {
  readonly size: HullSize;
  /** Mass of the bare structure, spread over the sections by their volume, kg. */
  readonly structureMass: number;
  /** Sections from nose to tail. */
  readonly sections: readonly SectionShape[];
}

const box = (width: number, height: number, lengths: readonly [number, number, number]) =>
  (['forward', 'middle', 'engine'] as const).map((kind, i) => ({
    kind,
    length: lengths[i] ?? 0,
    width,
    height,
  }));

export const HULLS: Readonly<Record<HullSize, Hull>> = {
  frigate: { size: 'frigate', structureMass: 300e3, sections: box(12, 12, [20, 40, 20]) },
  cruiser: { size: 'cruiser', structureMass: 1_200e3, sections: box(20, 20, [35, 70, 35]) },
  battleship: { size: 'battleship', structureMass: 4_000e3, sections: box(30, 30, [50, 100, 50]) },
};

export const hullLength = (hull: Hull): number =>
  hull.sections.reduce((total, s) => total + s.length, 0);
