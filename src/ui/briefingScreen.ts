import type { CampaignBattle } from '../campaign/campaign';
import type { CaptainSkill, IntelligenceFact, IntelligenceReport } from '../sim/battle';
import { COMPONENT_TEXT } from './damagePanel';
import { designSummary } from './designSummary';
import { el } from './el';
import { capitalise, formatCredits, formatKmPerS, formatMm, formatMW, SKILL_TEXT } from './format';

/** A fact a signal interceptor learned, as a label and its value. */
export const describeFact = (fact: IntelligenceFact): readonly [string, string] => {
  switch (fact.kind) {
    case 'hull-size':
      return ['Hull size', capitalise(fact.hullSize)];
    case 'drive-thrust':
      return [
        'Drive thrust',
        `${(fact.thrust / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MN`,
      ];
    case 'reactor-output':
      return ['Reactor', formatMW(fact.output)];
    case 'delta-v':
      return ['Delta-v', formatKmPerS(fact.deltaV)];
    case 'armour':
      return [
        `${capitalise(fact.section)} armour`,
        `${formatMm(fact.armour.thickness)} ${fact.armour.type}`,
      ];
    case 'weapons':
      return [
        'Weapons',
        fact.weapons.length === 0
          ? 'None'
          : fact.weapons.map((w) => `${w.count} × ${COMPONENT_TEXT[w.type]}`).join(', '),
      ];
    case 'missiles':
      return ['Missiles', fact.missiles.toLocaleString('en-GB')];
    case 'shields':
      return [
        'Shields',
        fact.shields.length === 0 ? 'None' : fact.shields.map((s) => COMPONENT_TEXT[s]).join(', '),
      ];
  }
};

const list = (rows: readonly (readonly [string, string])[]) =>
  el(
    'dl',
    { className: 'status-list design-summary' },
    ...rows.flatMap(([label, value]) => [
      el('dt', { text: label }),
      el('dd', { text: value, attrs: { 'aria-label': label } }),
    ]),
  );

/**
 * What the player's intelligence components learned about the enemy before the battle: its whole
 * design from a long-range scanner, the facts a signal interceptor cracked, or nothing at all.
 */
export const createIntelligenceReport = (report: IntelligenceReport | undefined) => {
  const parts: Node[] = [el('h2', { text: 'Intelligence report' })];
  if (!report || (!report.design && report.facts.length === 0)) {
    parts.push(
      el('p', {
        text: 'No intelligence: you go in blind, and learn about the enemy only through your sensors. A long-range scanner or a signal interceptor would tell you more before the battle.',
      }),
    );
  }
  if (report?.design) {
    parts.push(
      el('h3', { text: 'Long-range scanner: the enemy design' }),
      list(designSummary(report.design)),
    );
  }
  if (report && report.facts.length > 0) {
    parts.push(
      el('h3', { text: `Signal interceptor: ${String(report.facts.length)} facts` }),
      list(report.facts.map(describeFact)),
    );
  }
  return el(
    'section',
    {
      className: 'campaign-panel intelligence-report',
      attrs: { 'aria-label': 'Intelligence report' },
    },
    ...parts,
  );
};

export interface BriefingActions {
  readonly onFight: () => void;
  readonly onBack: () => void;
}

/** Before a campaign battle: the tier, the ship sent, and the intelligence report. */
export const createBriefingScreen = (
  battle: CampaignBattle,
  report: IntelligenceReport | undefined,
  tier: { readonly budget: number; readonly skill: CaptainSkill },
  actions: BriefingActions,
) => {
  const [player] = battle.setup.sides;
  const fight = el('button', {
    className: 'menu-button menu-button--primary',
    text: 'Fight',
    attrs: { type: 'button' },
  });
  fight.addEventListener('click', actions.onFight);
  const back = el('button', { className: 'menu-button', text: 'Back', attrs: { type: 'button' } });
  back.addEventListener('click', actions.onBack);
  return {
    element: el(
      'main',
      { className: 'menu-screen campaign-screen' },
      el('h1', { className: 'menu-title', text: `Tier ${String(battle.tier)} battle` }),
      el('p', {
        className: 'menu-tagline',
        text: `${player?.name ?? 'Your ship'} (${player?.design.name ?? ''}) against an opponent built on up to ${formatCredits(tier.budget)}, with a ${SKILL_TEXT[tier.skill].toLowerCase()} skill captain. ${battle.setup.scenario.name}.`,
      }),
      createIntelligenceReport(report),
      el('div', { className: 'setup-actions' }, back, fight),
    ),
    focus() {
      fight.focus();
    },
  };
};
