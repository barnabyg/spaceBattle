import {
  summariseBatch,
  type BatchBattle,
  type BatchSetup,
  type BatchSummary,
} from '../game/batch';
import type { BatchRequest, BatchResponse } from './batchWorker';
import { el } from './el';
import { formatBattleTime, formatDuration, formatPercent } from './format';
import { describeLoss, outcomeDetails, outcomeHeadline } from './resultScreen';

/** Battles run side by side in this many workers at most, leaving a core for the page. */
const MAX_WORKERS = 8;

export interface BatchScreenActions {
  /** Goes back to setup, stopping the batch run if it is still going. */
  readonly onBack: () => void;
}

const countText = (count: number, battles: number) =>
  `${count.toLocaleString('en-GB')} (${formatPercent(count / battles)})`;

/** The summary's rows: each side's wins, then draws, no results and the mean time to a result. */
const summaryRows = (summary: BatchSummary): readonly (readonly [string, string, string])[] => [
  ...summary.sides.map((side): readonly [string, string, string] => [
    `${side.name} · ${side.designName} wins`,
    `${side.name} wins`,
    countText(side.wins, summary.battles),
  ]),
  ['Draws', 'Draws', countText(summary.draws, summary.battles)],
  ['No result (time limit)', 'No result', countText(summary.noResults, summary.battles)],
  [
    'Mean time to result',
    'Mean time to result',
    summary.meanTimeToResult === null ? '—' : formatDuration(summary.meanTimeToResult),
  ],
];

/**
 * A test mode batch run: fights every battle of the batch without graphics, in background
 * workers so the page stays responsive, showing progress and then a summary of win rates and
 * outcomes, with each battle's seed so any one can be fought again.
 */
export const createBatchScreen = (batch: BatchSetup, actions: BatchScreenActions) => {
  const [blue, red] = batch.sides;
  const progress = el('progress', { attrs: { max: String(batch.battles), value: '0' } });
  const status = el('output', {
    className: 'batch-status',
    attrs: { 'aria-label': 'Batch progress', 'aria-live': 'polite' },
  });
  const results = el('div', { className: 'batch-results' });
  const back = el('button', {
    className: 'menu-button',
    text: 'Back to setup',
    attrs: { type: 'button' },
  });
  back.addEventListener('click', actions.onBack);

  const element = el(
    'main',
    { className: 'menu-screen batch-screen' },
    el('h1', { className: 'menu-title', text: 'Batch run' }),
    el('p', {
      className: 'menu-tagline',
      text: `${blue?.name ?? ''} · ${blue?.design.name ?? ''} (${blue?.skill ?? 'medium'} skill) against ${red?.name ?? ''} · ${red?.design.name ?? ''} (${red?.skill ?? 'medium'} skill), the computer commanding both sides: ${batch.battles.toLocaleString('en-GB')} battles with a time limit of ${formatDuration(batch.timeLimit)}, from batch seed ${batch.seed}.`,
    }),
    el('div', { className: 'batch-progress' }, progress, status),
    results,
    el('div', { className: 'setup-actions' }, back),
  );

  const started = performance.now();
  const battles: BatchBattle[] = [];
  let next = 0;
  let failed = false;

  const showProgress = () => {
    const seconds = (performance.now() - started) / 1000;
    progress.value = battles.length;
    status.textContent = `${battles.length.toLocaleString('en-GB')} of ${batch.battles.toLocaleString('en-GB')} battles · ${formatDuration(seconds)}`;
  };

  const showSummary = () => {
    const summary = summariseBatch(batch, battles);
    const lossLines = summary.sides.flatMap((side) =>
      side.losses.map(
        ({ loss, count }) =>
          `${describeLoss(side.name, loss)}: ${countText(count, summary.battles)}`,
      ),
    );
    results.replaceChildren(
      el(
        'section',
        { className: 'panel batch-summary', attrs: { 'aria-label': 'Batch summary' } },
        el('h2', { text: 'Summary' }),
        el(
          'dl',
          { className: 'status-list' },
          ...summaryRows(summary).flatMap(([label, name, value]) => [
            el('dt', { text: label }),
            el('dd', { text: value, attrs: { 'aria-label': name } }),
          ]),
        ),
        el('h3', { text: 'How sides lost' }),
        el(
          'ul',
          { className: 'battle-log', attrs: { 'aria-label': 'Losses' } },
          ...(lossLines.length > 0 ? lossLines : ['No side lost']).map((text) =>
            el('li', { text }),
          ),
        ),
        el(
          'details',
          { className: 'batch-battles' },
          el('summary', { text: 'Each battle' }),
          el(
            'ol',
            { className: 'battle-log' },
            ...[...battles]
              .sort((a, b) => a.index - b.index)
              .map(({ index, seed, outcome }) =>
                el('li', {
                  text: `Battle ${index + 1} · seed ${seed} · ${outcomeHeadline(outcome, batch.sides)} · ${outcomeDetails(outcome, batch.sides).join(' · ')} · ended ${formatBattleTime(outcome.time)}`,
                }),
              ),
          ),
          el('p', {
            className: 'menu-note',
            text: 'To fight one again and watch it, enter its seed on setup with the computer commanding both sides.',
          }),
        ),
      ),
    );
  };

  const workers = Array.from(
    {
      length: Math.max(1, Math.min(navigator.hardwareConcurrency - 1, MAX_WORKERS, batch.battles)),
    },
    () => new Worker(new URL('./batchWorker.ts', import.meta.url), { type: 'module' }),
  );
  const stop = () => {
    for (const worker of workers) worker.terminate();
  };
  const fail = (message: string) => {
    if (failed) return;
    failed = true;
    stop();
    status.textContent = `Batch run failed: ${message}`;
  };
  /** Gives the worker the next battle, if any are left. */
  const give = (worker: Worker) => {
    if (next >= batch.battles) return;
    const request: BatchRequest = { batch, index: next };
    next += 1;
    worker.postMessage(request);
  };
  for (const worker of workers) {
    worker.addEventListener('message', (event: MessageEvent<BatchResponse>) => {
      const response = event.data;
      if (response.type === 'error') {
        fail(response.message);
        return;
      }
      battles.push(response.battle);
      showProgress();
      if (battles.length === batch.battles) {
        stop();
        showSummary();
      } else {
        give(worker);
      }
    });
    worker.addEventListener('error', (event) => {
      fail(event.message || 'a battle could not be fought');
    });
    give(worker);
  }
  showProgress();

  return {
    element,
    /** Puts the keyboard on the way back. */
    focus() {
      back.focus();
    },
    /** Stops any battles still being fought. */
    dispose() {
      stop();
    },
  };
};
