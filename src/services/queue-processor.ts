import { CONFIG } from '../lib/config.js';
import { basename, join } from 'path';
import { rename, mkdir } from 'fs/promises';
import {
  getNextQueueItem,
  markQueueItemProcessing,
  markQueueItemCompleted,
  markQueueItemFailed,
} from './database.js';
import { processDocument } from './classifier.js';
import { getUniqueFilename } from './file-utils.js';

let running = false;
let paused = false;
let processingTimeout: NodeJS.Timeout | null = null;

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

function scheduleNextPoll(): void {
  if (!running) return;
  processingTimeout = setTimeout(processNextItem, CONFIG.pollIntervalMs);
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
