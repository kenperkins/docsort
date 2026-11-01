import { CONFIG } from '../lib/config.js';
import { basename, join } from 'path';
import { rename, mkdir } from 'fs/promises';
import {
  getNextQueueItem,
  markQueueItemProcessing,
  markQueueItemCompleted,
  markQueueItemFailed,
  markQueueItemPending,
} from './database.js';
import { processDocument } from './classifier.js';
import { ProviderUnavailableError } from '../classifier/index.js';
import { getUniqueFilename } from './file-utils.js';

let running = false;
let paused = false;
let processingTimeout: NodeJS.Timeout | null = null;
let unavailableStreak = 0;
let unavailable: ClassifierUnavailable | null = null;

export interface ClassifierUnavailable {
  error: string;
  retryAt: string;
}

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

/** 30s, 60s, 120s ... capped at 10 minutes. */
export function backoffDelayMs(streak: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, streak - 1));
}

export function startQueueProcessor(): void {
  if (running) return;
  running = true;
  console.log('[QueueProcessor] Started');
  scheduleNextPoll();
}

export function stopQueueProcessor(): void {
  running = false;
  if (processingTimeout) {
    clearTimeout(processingTimeout);
    processingTimeout = null;
  }
  console.log('[QueueProcessor] Stopped');
}

export function isQueueProcessorRunning(): boolean {
  return running;
}

// Pausing keeps the poll loop (and readiness) alive but skips work, so maintenance
// such as the tag migration can run without new documents being filed mid-way.
export function setQueuePaused(value: boolean): void {
  paused = value;
  console.log(`[QueueProcessor] ${paused ? 'Paused' : 'Resumed'}`);
}

export function isQueuePaused(): boolean {
  return paused;
}

/** Why the queue is waiting on the classifier, or null while it's reachable. */
export function getClassifierUnavailable(): ClassifierUnavailable | null {
  return unavailable;
}

function scheduleNextPoll(delayMs: number = CONFIG.pollIntervalMs): void {
  if (!running) return;
  processingTimeout = setTimeout(processNextItem, delayMs);
}

async function processNextItem(): Promise<void> {
  if (!running) return;
  if (paused) {
    scheduleNextPoll();
    return;
  }

  try {
    const item = getNextQueueItem();

    if (!item) {
      scheduleNextPoll();
      return;
    }

    console.log(`[QueueProcessor] Processing queue item ${item.id}: ${item.filepath}`);
    markQueueItemProcessing(item.id);

    try {
      const result = await processDocument(item.filepath);
      if (unavailableStreak > 0) {
        console.log('[QueueProcessor] Classifier reachable again');
        unavailableStreak = 0;
      }
      unavailable = null;

      if (result.isDuplicate && result.duplicateOf) {
        // Move duplicate to graveyard with "duplicate-" prefix
        const graveyardDir = join(CONFIG.graveyardDir, 'duplicates');
        await mkdir(graveyardDir, { recursive: true });
        const destPath = await getUniqueFilename(graveyardDir, `duplicate-of-${result.duplicateOf.documentId}-${basename(item.filepath)}`);
        await rename(item.filepath, destPath);
        console.log(`[QueueProcessor] Moved duplicate to graveyard: ${destPath}`);
        markQueueItemCompleted(item.id, result.duplicateOf.documentId);
        console.log(`[QueueProcessor] Completed queue item ${item.id} (duplicate)`);
      } else {
        markQueueItemCompleted(item.id, result.documentId);
        console.log(`[QueueProcessor] Completed queue item ${item.id}`);
      }
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        // The endpoint, not the document: put it back and wait, rather than marking it failed.
        markQueueItemPending(item.id);
        unavailableStreak += 1;
        const delay = backoffDelayMs(unavailableStreak);
        unavailable = { error: err.message, retryAt: new Date(Date.now() + delay).toISOString() };
        if (unavailableStreak === 1 || delay === BACKOFF_MAX_MS) {
          console.warn(`[QueueProcessor] Classifier unavailable (${err.message}); retrying in ${Math.round(delay / 1000)}s`);
        }
        scheduleNextPoll(delay);
        return;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[QueueProcessor] Failed queue item ${item.id}: ${errorMessage}`);
      markQueueItemFailed(item.id, errorMessage);
    }
  } catch (err) {
    console.error('[QueueProcessor] Error in processing loop:', err);
  }

  // Continue polling
  scheduleNextPoll();
}
