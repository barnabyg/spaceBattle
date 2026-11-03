import { expect, test, type Page } from '@playwright/test';
import { startFreeBattle } from './freeBattle';

declare global {
  interface Window {
    /** Every audio context the page made, oldest first, recorded for these tests. */
    audioContexts?: AudioContext[];
  }
}

test.beforeEach(async ({ page }) => {
  // Record each audio context the game makes, to see it start and be given up.
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.audioContexts = [];
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.audioContexts?.push(this);
      }
    };
  });
});

const audioStates = (page: Page) =>
  page.evaluate(() => (window.audioContexts ?? []).map((ctx) => ctx.state));

test('the ship sounds with volume and mute that last for the session', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await startFreeBattle(page);

  const sound = page.getByRole('group', { name: 'Sound' });
  const mute = sound.getByRole('button', { name: 'Mute' });
  const volume = sound.getByLabel('Volume');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(volume).toHaveValue('50');
  // The captain's click that started the battle lets its sound start.
  await expect.poll(() => audioStates(page)).toEqual(['running']);

  await volume.fill('20');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  // M toggles mute too.
  await page.keyboard.press('m');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('m');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'End battle' }).click();
  await page.getByRole('button', { name: 'Forfeit' }).click();
  await page.getByRole('button', { name: 'Back to setup' }).click();
  // Leaving the battle gives up its audio.
  await expect.poll(() => audioStates(page)).toEqual(['closed']);

  // The next battle keeps the settings.
  await page.getByRole('button', { name: 'Start battle' }).click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(volume).toHaveValue('20');
  await expect.poll(() => audioStates(page)).toEqual(['closed', 'running']);
  expect(errors).toEqual([]);
});

test('a battle between computer sides is silent', async ({ page }) => {
  await startFreeBattle(page, { blue: { commander: 'Computer' } });
  await expect(page.getByRole('group', { name: 'Sound' })).toHaveCount(0);
  expect(await audioStates(page)).toEqual([]);
});
