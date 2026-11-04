import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBattle, type ContactObservation } from '../sim/battle';
import { duelSetup, TEST_LASER, testDesign, withSection } from '../sim/testing';
import {
  contactModelDetail,
  contactModelExtent,
  createContactModel,
  disposeContactModel,
  updateContactModel,
  type ContactModelPartData,
} from './contactModel';

const KM = 1000;

const visible = (model: THREE.Object3D, kind: ContactModelPartData['kind']) => {
  const found: ContactModelPartData[] = [];
  model.traverse((object) => {
    const data = object.userData as Partial<ContactModelPartData>;
    if (data.kind === kind && object.visible) found.push(data as ContactModelPartData);
  });
  return found;
};

/**
 * Red, with a laser on its nose and no radiator, as blue's test sensor sees it at a range: its
 * 80 m silhouette, its 40 m middle section, its 20 m nose and tail, then the laser.
 */
const contactAt = (range: number, fire = false): ContactObservation => {
  const red = withSection(withSection(testDesign(), 'middle', { mounts: [] }), 'forward', {
    mounts: [TEST_LASER],
  });
  const battle = createBattle(duelSetup(testDesign(), red, range));
  if (fire) battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
  battle.advance(15.5);
  const contact = battle.observe('blue').contacts[0];
  if (!contact) throw new Error('No contact');
  return contact;
};

describe('contact model', () => {
  it('keeps each contact colour on its dot and resolved outlines without recolouring its armour', () => {
    const blue = createContactModel('#4fa3ff');
    const red = createContactModel('#ff5a4f');
    const coloursOf = (model: THREE.Group) => {
      const colours: string[] = [];
      model.traverseVisible((object) => {
        if (
          !(object instanceof THREE.LineSegments) &&
          !(object instanceof THREE.Sprite) &&
          !(object instanceof THREE.Mesh)
        )
          return;
        const material: unknown = object.material;
        if (
          material instanceof THREE.LineBasicMaterial ||
          material instanceof THREE.SpriteMaterial ||
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshBasicMaterial
        ) {
          colours.push(material.color.getHexString());
        }
      });
      return colours;
    };
    for (const range of [10_000_000 * KM, 1_000 * KM, 100_000 * KM]) {
      updateContactModel(blue, contactAt(range));
      updateContactModel(red, contactAt(range));
      expect(coloursOf(blue)).toContain('4fa3ff');
      expect(coloursOf(blue)).not.toContain('ff5a4f');
      expect(coloursOf(red)).toContain('ff5a4f');
      if (range === 1_000 * KM) expect(coloursOf(red)).toContain('9aa0a8');
    }
    disposeContactModel(red);
    disposeContactModel(blue);
  });

  it('frames only observed geometry and forgets detail as range opens', () => {
    const model = createContactModel();
    updateContactModel(model, contactAt(1_000 * KM));
    expect(visible(model, 'mount')).not.toHaveLength(0);
    expect(contactModelExtent(model)).toBe(80);

    updateContactModel(model, contactAt(100_000 * KM));
    expect(visible(model, 'section')).toHaveLength(0);
    expect(visible(model, 'mount')).toHaveLength(0);
    expect(visible(model, 'silhouette')).not.toHaveLength(0);

    updateContactModel(model, contactAt(10_000_000 * KM));
    expect(visible(model, 'silhouette')).toHaveLength(0);
    expect(visible(model, 'section')).toHaveLength(0);
    expect(visible(model, 'mount')).toHaveLength(0);
    expect(visible(model, 'dot')).toHaveLength(1);
    // A position-only contact has no disclosed hull dimensions.
    expect(contactModelExtent(model)).toBeNull();
  });
  it.each([
    [10_000_000 * KM, 'position'],
    [100_000 * KM, 'silhouette'],
    [50_000 * KM, 'sections'],
    [1_000 * KM, 'mounts'],
  ] as const)(
    'at %d m draws the contact in the detail the sensors resolve: %s',
    (range, detail) => {
      const contact = contactAt(range);
      expect(contact.detail).toBe(detail);
      const model = createContactModel();
      updateContactModel(model, contact);
      expect(contactModelDetail(model)).toBe(contact.detail);

      expect(visible(model, 'dot')).toHaveLength(detail === 'position' ? 1 : 0);
      const sections = visible(model, 'section').map((p) => p.section);
      expect(sections).toEqual(contact.sections.map((s) => s.kind));
      const mounts = visible(model, 'mount').map((p) => `${p.section}/${String(p.mount)}`);
      expect(mounts).toEqual(contact.mounts.map((m) => `${m.section}/${String(m.mount)}`));
      // What is not made out shows only as part of the silhouette.
      const made = sections.length + mounts.length;
      expect(visible(model, 'silhouette')).toHaveLength(contact.appearance.outline.length - made);
    },
  );

  it('shows which of the mounts it makes out is firing', () => {
    const quiet = createContactModel();
    updateContactModel(quiet, contactAt(1_000 * KM));
    expect(visible(quiet, 'mount').some((p) => p.firing)).toBe(false);

    const contact = contactAt(1_000 * KM, true);
    const laser = contact.mounts.find((m) => m.component.type === 'laser');
    expect(laser?.firing).toBe(true);
    const firing = createContactModel();
    updateContactModel(firing, contact);
    expect(visible(firing, 'mount').filter((p) => p.firing)).toEqual([
      { kind: 'mount', section: laser?.section, mount: laser?.mount, firing: true },
    ]);
  });
});
