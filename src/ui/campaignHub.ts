import { BALANCE } from '../data/balance';
import type { Campaign } from '../campaign/campaign';
import type { Design } from '../sim/design';
import { designCost } from '../shipyard/cost';
import { el } from './el';
import { formatCredits } from './format';

const SKILL_TEXT = { low: 'Low', medium: 'Medium', high: 'High' } as const;

export interface CampaignHubActions {
  /** Builds a ship of a design into the hangar. */
  readonly onBuild: (design: Design) => void;
  /** Sends a ship from the hangar against an opponent of a tier. */
  readonly onFight: (shipId: string, tier: number) => void;
  /** Goes to the shipyard to design ships to build. */
  readonly onShipyard: () => void;
  /** Leaves for the main menu; the campaign is kept until the page closes. */
  readonly onMainMenu: () => void;
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
  const hangar = el('ul', { className: 'campaign-list' });
  hangar.replaceChildren(
    ...campaign.hangar.map((ship) =>
      el(
        'li',
        { attrs: { 'aria-label': ship.name } },
        el('span', { className: 'campaign-list__name', text: ship.name }),
        el('span', { text: ship.design.name }),
      ),
    ),
  );
  if (campaign.hangar.length === 0) {
    hangar.append(el('li', { className: 'menu-note', text: 'No ships yet: build one below.' }));
  }

  const buildable = [
    ...campaign.designs,
    ...libraryDesigns.filter((d) => !campaign.designs.some((known) => known.id === d.id)),
  ];
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
          text: `${design.hullSize.charAt(0).toUpperCase()}${design.hullSize.slice(1)} · ${formatCredits(cost)}`,
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
    ...campaign.hangar.map((s) =>
      el('option', { text: `${s.name} · ${s.design.name}`, attrs: { value: s.id } }),
    ),
  );
  const tiers = el(
    'ul',
    { className: 'campaign-list' },
    ...BALANCE.tiers.map((tier) => {
      const fight = button(`Fight tier ${tier.tier}`, `Fight tier ${tier.tier}`);
      fight.disabled = campaign.hangar.length === 0;
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
    el('div', { className: 'setup-actions' }, mainMenu),
  );

  return {
    element,
    focus() {
      mainMenu.focus();
    },
  };
};
