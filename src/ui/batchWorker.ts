import { runBatchBattle, type BatchBattle, type BatchSetup } from '../game/batch';

/** Asks a worker to fight one battle of a batch. */
export interface BatchRequest {
  readonly batch: BatchSetup;
  readonly index: number;
}

/** A worker's answer: the battle fought, or why it could not be. */
export type BatchResponse =
  | { readonly type: 'battle'; readonly battle: BatchBattle }
  | { readonly type: 'error'; readonly message: string };

// Each worker fights the battles it is given one at a time, off the page's thread.
self.addEventListener('message', (event: MessageEvent<BatchRequest>) => {
  const { batch, index } = event.data;
  let response: BatchResponse;
  try {
    response = { type: 'battle', battle: runBatchBattle(batch, index) };
  } catch (error) {
    response = { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
});
