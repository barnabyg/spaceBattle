import { BALANCE } from '../data/balance';
import {
  refitCost,
  repairCost,
  restockCost,
  saleValue,
  type Campaign,
  campaignOver,
  canFight,
  MIN_REPAIR_SHARE,
  type CampaignShip,
} from '../campaign/campaign';
import type { Design } from '../sim/design';
import { designCost } from '../shipyard/cost';
import { el } from './el';
import { capitalise, formatCredits, SKILL_TEXT } from './format';

export interface CampaignHubActions {
  /** Builds a ship of a design into the hangar. */
  readonly onBuild: (design: Design) => void;
  /** Repairs a share (0–1) of a ship's damage. */
  readonly onRepair: (shipId: string, share: number) => void;
  /** Refills a ship's propellant and ammunition. */
  readonly onRestock: (shipId: string) => void;
  /** Refits a ship to another design on its hull size. */
  readonly onRefit: (shipId: string, design: Design) => void;
  /** Sells a ship. */
  readonly onSell: (shipId: string) => void;
  /** Sends a ship from the hangar against an opponent of a tier. */
  readonly onFight: (shipId: string, tier: number) => void;
  /** Goes to the shipyard to design ships to build. */
  readonly onShipyard: () => void;
  /** Leaves for the main menu; the campaign is kept until the page closes. */
  readonly onMainMenu: () => void;
  /** Gives up this campaign for a new one. */
  readonly onNewCampaign: () => void;
  /** Saves the campaign to a file; nothing is saved without it. */
  readonly onSave: () => void;
}

const region = (label: string, ...children: Node[]) =>
  el(
    'section',
    { className: 'campaign-panel', attrs: { 'aria-label': label } },
    el('h2', { text: label }),
    ...children,
  );

const button = (text: string, label = text, primary = false) =>
  el('button', {
    className: primary ? 'menu-button menu-button--primary' : 'order-button',
    text,
    attrs: { type: 'button', 'aria-label': label },
  });

/**
 * The campaign hub, between battles: the player's credits and hangar, the designs they can build
 * (the campaign's and those saved in the shipyard), and the tiers they can fight, each with its
 * opponent's budget, captain skill and reward.
 */
export const createCampaignHub = (
  campaign: Campaign,
  /** Designs saved in the shipyard, offered for building beside the campaign's own. */
  libraryDesigns: readonly Design[],
  actions: CampaignHubActions,
  /** What the last action or battle came to, if anything. */
  message = '',
) => {
  const over = campaignOver(campaign);
  const buildable = [
    ...campaign.designs,
    ...libraryDesigns.filter((d) => !campaign.designs.some((known) => known.id === d.id)),
  ];

  /** A ship's refit: the designs on its hull size to choose from, each with its price. */
  const refitChoice = (ship: CampaignShip) => {
    const options = buildable.filter(
      (d) => d.hullSize === ship.design.hullSize && d.id !== ship.design.id,
    );
    const choice = el(
      'select',
      { attrs: { 'aria-label': `Refit ${ship.name} to` } },
      ...options.map((d) =>
        el('option', {
          text: `${d.name} · ${formatCredits(refitCost(ship, d))}`,
          attrs: { value: d.id },
        }),
      ),
    );
    const refit = button('Refit', `Refit ${ship.name}`);
    refit.disabled = options.length === 0;
    refit.addEventListener('click', () => {
      const design = options.find((d) => d.id === choice.value);
      if (design) actions.onRefit(ship.id, design);
    });
    return el('span', { className: 'campaign-list__actions' }, choice, refit);
  };

  /** Sells a ship, on a second click to confirm: it cannot be undone. */
  const sellButton = (ship: CampaignShip) => {
    const value = formatCredits(saleValue(ship));
    const sell = button(`Sell for ${value}`, `Sell ${ship.name}`);
    let armed = false;
    sell.addEventListener('click', () => {
      if (armed) {
        actions.onSell(ship.id);
        return;
      }
      armed = true;
      sell.textContent = `Confirm sale for ${value}`;
    });
    return sell;
  };

  /**
   * A ship in the hangar: its design, what its damage would cost to repair and its used propellant
   * and ammunition to restock, and the buttons to pay for them; a share of the repair can be paid.
   */
  const hangarEntry = (ship: CampaignShip) => {
    const repair = repairCost(ship);
    const restock = restockCost(ship);
    const share = el('input', {
      attrs: {
        type: 'number',
        min: String(MIN_REPAIR_SHARE * 100),
        max: '100',
        step: '1',
        'aria-label': `Share of ${ship.name}'s repairs %`,
      },
    });
    share.value = '100';
    const repairButton = button('Repair', `Repair ${ship.name}`);
    repairButton.disabled = repair <= 0 || repair * MIN_REPAIR_SHARE > campaign.credits;
    repairButton.addEventListener('click', () => {
      const percent = share.valueAsNumber;
      if (percent >= MIN_REPAIR_SHARE * 100 && percent <= 100) {
        actions.onRepair(ship.id, percent / 100);
      }
    });
    const restockButton = button('Restock', `Restock ${ship.name}`);
    restockButton.disabled = restock <= 0 || restock > campaign.credits;
    restockButton.addEventListener('click', () => {
      actions.onRestock(ship.id);
    });
    const state = [
      repair > 0 ? `Damaged: repairs ${formatCredits(repair)}` : 'Undamaged',
      restock > 0 ? `restocking ${formatCredits(restock)}` : 'full',
    ].join(' · ');
    return el(
      'li',
      { attrs: { 'aria-label': ship.name } },
      el('span', { className: 'campaign-list__name', text: ship.name }),
      el('span', { text: ship.design.name }),
      el('span', {
        className: 'campaign-list__state',
        text: state,
        attrs: { 'aria-label': `${ship.name} condition` },
      }),
      el(
        'span',
        { className: 'campaign-list__actions' },
        ...(repair > 0
          ? [el('label', { className: 'field field--inline' }, el('span', { text: '%' }), share)]
          : []),
        repairButton,
        restockButton,
      ),
      refitChoice(ship),
      sellButton(ship),
    );
  };
  const hangar = el('ul', { className: 'campaign-list' });
  hangar.replaceChildren(...campaign.hangar.map(hangarEntry));
  if (campaign.hangar.length === 0) {
    hangar.append(el('li', { className: 'menu-note', text: 'No ships yet: build one below.' }));
  }

  const designs = el(
    'ul',
    { className: 'campaign-list' },
    ...buildable.map((design) => {
      const cost = designCost(design);
      const build = button('Build', `Build ${design.name}`);
      build.disabled = cost > campaign.credits;
      build.addEventListener('click', () => {
        actions.onBuild(design);
      });
      return el(
        'li',
        {},
        el('span', { className: 'campaign-list__name', text: design.name }),
        el('span', {
          text: `${capitalise(design.hullSize)} · ${formatCredits(cost)}`,
        }),
        build,
      );
    }),
  );
  const shipyard = button('Shipyard', 'Shipyard');
  shipyard.addEventListener('click', actions.onShipyard);

  const ship = el(
    'select',
    { attrs: { 'aria-label': 'Ship to fight' } },
    // Only a ship able to fight is offered: one that would lose at once must be put right first.
    ...campaign.hangar
      .filter(canFight)
      .map((s) => el('option', { text: `${s.name} · ${s.design.name}`, attrs: { value: s.id } })),
  );
  const tiers = el(
    'ul',
    { className: 'campaign-list' },
    ...BALANCE.tiers.map((tier) => {
      const fight = button(`Fight tier ${tier.tier}`, `Fight tier ${tier.tier}`);
      fight.disabled = !campaign.hangar.some(canFight);
      fight.addEventListener('click', () => {
        actions.onFight(ship.value, tier.tier);
      });
      return el(
        'li',
        {},
        el('span', { className: 'campaign-list__name', text: `Tier ${tier.tier}` }),
        el('span', {
          text: `Opponent budget ${formatCredits(tier.budget)} · ${SKILL_TEXT[tier.skill]} skill captain · pays ${formatCredits(tier.reward)}`,
        }),
        fight,
      );
    }),
  );

  const save = el('button', {
    className: 'menu-button',
    text: 'Save campaign',
    attrs: { type: 'button' },
  });
  save.addEventListener('click', actions.onSave);
  const newCampaign = el('button', {
    className: over ? 'menu-button menu-button--primary' : 'menu-button',
    text: 'New campaign',
    attrs: { type: 'button' },
  });
  let confirmNew = over;
  newCampaign.addEventListener('click', () => {
    // Giving up a campaign under way takes a second click.
    if (confirmNew) {
      actions.onNewCampaign();
      return;
    }
    confirmNew = true;
    newCampaign.textContent = 'Give up this campaign';
  });
  const mainMenu = el('button', {
    className: 'menu-button',
    text: 'Main menu',
    attrs: { type: 'button' },
  });
  mainMenu.addEventListener('click', actions.onMainMenu);

  const element = el(
    'main',
    { className: 'menu-screen campaign-screen' },
    el('h1', { className: 'menu-title', text: 'Campaign' }),
    el(
      'p',
      { className: 'campaign-credits' },
      el('span', { text: 'Credits ' }),
      el('strong', { text: formatCredits(campaign.credits), attrs: { 'aria-label': 'Credits' } }),
      el('span', {
        className: 'menu-note',
        text: ` · ${campaign.battles.toLocaleString('en-GB')} ${campaign.battles === 1 ? 'battle' : 'battles'} fought`,
      }),
    ),
    el('p', { className: 'menu-note', text: message, attrs: { role: 'status' } }),
    ...(over
      ? [
          el(
            'div',
            { className: 'campaign-over', attrs: { role: 'alert' } },
            el('h2', { text: 'Campaign over' }),
            el('p', {
              text: 'No ship in the hangar can fight, none can be put right, and no new one can be afforded.',
            }),
          ),
        ]
      : []),
    el(
      'div',
      { className: 'campaign' },
      region('Hangar', hangar),
      region('Build a ship', designs, shipyard),
      region(
        'Fight',
        el('label', { className: 'field' }, el('span', { text: 'Ship to fight' }), ship),
        tiers,
      ),
    ),
    el('div', { className: 'setup-actions' }, mainMenu, save, newCampaign),
  );

  return {
    element,
    focus() {
      mainMenu.focus();
    },
  };
};
