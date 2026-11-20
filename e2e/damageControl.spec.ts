import { expect, test } from '@playwright/test';

test('the Damage tab sets the crew repairing a damaged component, and stops them', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createBattle } = await import('../src/sim/battle');
    const { duelSetup, testDesign } = await import('../src/sim/testing');
    const { fullCondition } = await import('../src/sim/ship');
    const { componentSlots } = await import('../src/sim/components');
    const { createDamagePanel } = await import('../src/ui/damagePanel');
    const design = testDesign();
    const radiator = componentSlots(design).findIndex((s) => s.component.type === 'radiator');
    const full = fullCondition(design);
    const condition = {
      ...full,
      integrity: full.integrity.map((value, i) => (i === radiator ? 0.3 : value)),
    };
    const setup = duelSetup(design, testDesign(), 50_000e3);
    const battle = createBattle({
      ...setup,
      sides: setup.sides.map((side) =>
        side.id === 'blue' ? { ...side, commander: 'player' as const, condition } : side,
      ),
    });
    const panel = createDamagePanel('blue', {
      onRepair: (target) => {
        battle.giveOrder('blue', { type: 'repair', target });
      },
    });
    document.body.replaceChildren(panel.element);
    panel.update(battle.observe('blue'));
    (window as unknown as { advance: (s: number) => void }).advance = (seconds) => {
      battle.advance(seconds);
      panel.update(battle.observe('blue'));
    };
  });
  const repair = page.getByRole('button', { name: /^Repair Radiator \(mount\)/ });
  await expect(repair).toBeVisible();
  // Undamaged parts have no Repair button to press.
  await expect(page.getByRole('button', { name: /^Repair Drive/ })).toBeHidden();
  await repair.click();
  await page.evaluate(() => {
    (window as unknown as { advance: (s: number) => void }).advance(50);
  });
  const row = page.getByRole('listitem').filter({ hasText: 'Radiator (mount)' });
  // 30% plus 50 s at 0.2% a second, shown rounded down.
  await expect(row).toContainText(/(39|40)% · repairing/);
  await expect(repair).toHaveText('Stop');
  await repair.click();
  await page.evaluate(() => {
    (window as unknown as { advance: (s: number) => void }).advance(50);
  });
  await expect(row).toContainText(/(39|40)%/);
  await expect(row).not.toContainText('repairing');
});
