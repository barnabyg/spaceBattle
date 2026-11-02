import { handMadeDesign } from './data/designs';
import { OPENING_PASS } from './data/scenarios';
import { createBattleRunner } from './game/battleRunner';
import { createBattle, type SideSetup } from './sim/battle';
import { createBattleScreen } from './ui/battleScreen';
import './ui/styles.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing #app element');

const sides: SideSetup[] = [
  { id: 'blue', name: 'Blue', commander: 'player', design: handMadeDesign('lance') },
  { id: 'red', name: 'Red', commander: 'computer', design: handMadeDesign('bastion') },
];

const battle = createBattle({ seed: Date.now() >>> 0, scenario: OPENING_PASS, sides });
// Until the computer captain commands its ship (#24), it simply fires freely at the player.
battle.giveOrder('red', { type: 'weapons', target: 'blue', mode: 'fire-freely' });
app.append(createBattleScreen(createBattleRunner(battle)).element);
