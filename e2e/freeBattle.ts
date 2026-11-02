import { expect, type Page } from '@playwright/test';

/** One side's choices on the free battle setup screen; anything left out keeps its default. */
export interface SideChoice {
  readonly design?: string;
  readonly commander?: 'Player' | 'Computer';
}

/** Picks a side's design and commander on the setup screen. */
export const chooseSide = async (page: Page, side: 'Blue' | 'Red', choice: SideChoice) => {
  const region = page.getByRole('region', { name: `${side} side` });
  if (choice.design) await region.getByLabel('Design').selectOption({ label: choice.design });
  if (choice.commander) {
    await region.getByLabel('Commander').selectOption({ label: choice.commander });
  }
};

/**
 * Goes from the main menu through free battle setup into a battle, by default Blue's Lance
 * (player) against Red's Bastion (computer), and waits for the battle screen.
 */
export const startFreeBattle = async (
  page: Page,
  choices: { readonly blue?: SideChoice; readonly red?: SideChoice } = {},
) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Free battle' }).click();
  await chooseSide(page, 'Blue', choices.blue ?? {});
  await chooseSide(page, 'Red', choices.red ?? {});
  await page.getByRole('button', { name: 'Start battle' }).click();
  await expect(page.getByRole('region', { name: 'Tactical map' }).locator('canvas')).toBeVisible();
};
