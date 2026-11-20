import type { NarrationLine } from '../game/narration';
import { el } from './el';
import { formatBattleTime } from './format';

/** How long a routine line stays over the view, real s... */
const ROUTINE_SHOWN = 6;
/** ...and a line that needs the captain. */
const MAJOR_SHOWN = 15;
/** At most this many lines over the view at once, the newest at the bottom. */
const MAX_SHOWN = 4;
/** The battle log keeps this many lines. */
const HISTORY_LENGTH = 40;

/**
 * The battle's story as it happens: each line shows briefly over the instrument view, fading, with
 * the own ship's lines, the enemy's and the battle's told apart by colour, and is kept in a history
 * for the Damage tab.
 */
export const createNarrationFeed = () => {
  const overlay = el('ol', {
    className: 'narration',
    attrs: { role: 'log', 'aria-label': 'Battle narration', 'aria-live': 'polite' },
  });
  const historyList = el('ol', { className: 'narration-history' });
  const history = el(
    'section',
    { className: 'panel', attrs: { 'aria-label': 'Battle story' } },
    el('h2', { text: 'Battle story' }),
    historyList,
  );
  const shown: { readonly item: HTMLLIElement; readonly until: number; readonly from: number }[] =
    [];

  const lineItem = (line: NarrationLine, withTime: boolean) =>
    el('li', {
      className: `narration__line narration__line--${line.about}${line.major ? ' narration__line--major' : ''}`,
      text: withTime ? `${formatBattleTime(line.time)} ${line.text}` : line.text,
    });

  return {
    overlay,
    history,
    /** Adds an update's lines, at real time `now`, s. */
    add(lines: readonly NarrationLine[], now: number) {
      for (const line of lines) {
        const item = lineItem(line, false);
        overlay.append(item);
        shown.push({ item, from: now, until: now + (line.major ? MAJOR_SHOWN : ROUTINE_SHOWN) });
        historyList.prepend(lineItem(line, true));
      }
      while (historyList.children.length > HISTORY_LENGTH) historyList.lastElementChild?.remove();
    },
    /** Fades and removes lines whose time is up, at real time `now`, s. */
    update(now: number) {
      for (let i = shown.length - 1; i >= 0; i--) {
        const entry = shown[i];
        if (!entry) continue;
        const left = entry.until - now;
        const tooMany = i < shown.length - MAX_SHOWN;
        if (left <= 0 || tooMany) {
          entry.item.remove();
          shown.splice(i, 1);
        } else {
          // Fades out over its last two seconds.
          entry.item.style.opacity = String(Math.min(1, left / 2));
        }
      }
    },
  };
};
