import { existsSync } from 'fs';
import { basename, join } from 'path';
import { CONFIG } from '../lib/config.js';
import type { QueueItem, QueueSourceType } from '../lib/types.js';
import { getDatabase, enqueueDocument } from './database.js';
import { safeMoveFile, getUniqueFilename } from './file-utils.js';

export interface FailureExplanation {
  reason: string;
  hint: string;
}

const EXPLANATIONS: [RegExp, FailureExplanation][] = [
  [
    /Invalid PDF structure|InvalidPDFException|PasswordException|bad XRef/i,
    { reason: 'Can’t read this PDF — the file looks damaged or is password-protected.', hint: 'Rescan it or replace the file.' },
  ],
  [
    /exceeds \d+ MB maximum|request_too_large|image.*too large/i,
    { reason: 'A page is too large to send for classification.', hint: 'Rescan at a lower resolution, then retry.' },
  ],
  [
    /credit balance is too low/i,
    { reason: 'The Anthropic account is out of credit.', hint: 'Add credit, then retry.' },
  ],
  [
    /not_found_error.*model/i,
    { reason: 'The AI model the app uses is no longer available.', hint: 'Retry once the app has been updated.' },
  ],
  [
    /not available for this API key|not in the proxy's price list/i,
    { reason: 'The AI proxy doesn’t allow this model.', hint: 'Check CLAUDE_MODEL against the proxy’s allowed models.' },
  ],
  [
    /authentication_error|invalid x-api-key|permission_error|auth_error|token_not_found_in_db/i,
    { reason: 'The app’s Anthropic API key was rejected.', hint: 'Check the API key secret, then retry.' },
  ],
  [
    /budget_exceeded|Budget has been exceeded/i,
    {
      reason: 'The monthly AI budget is used up.',
      hint: 'Documents will resume when it resets on the 1st, or raise the budget in perkins.io’s apps/llm-proxy/access.yaml.',
    },
  ],
  [
    /rate_limit|overloaded|api_error|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up/i,
    { reason: 'The AI service had a temporary problem.', hint: 'Retry.' },
  ],
];

export function explainFailure(errorMessage: string | null): FailureExplanation {
  const message = errorMessage ?? '';
  for (const [pattern, explanation] of EXPLANATIONS) {
    if (pattern.test(message)) return explanation;
  }
  return { reason: 'Classification failed.', hint: 'Check the details, then retry.' };
}

export interface QueueProblem extends FailureExplanation {
  queueId: number;
  filepath: string;
  filename: string;
  attempts: number;
  firstFailedAt: string;
  lastFailedAt: string;
  error: string | null;
}

/**
 * Files that need a human: the latest queue attempt failed and the file is still in a
 * drop folder. A file that was later processed (or moved away) is not actionable, so
 * old failed attempts never show up here.
 */
export function getQueueProblems(): QueueProblem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT q.id, q.filepath, q.error_message, q.completed_at,
         (SELECT COUNT(*) FROM queue f WHERE f.filepath = q.filepath AND f.status = 'failed') AS attempts,
         (SELECT MIN(f.completed_at) FROM queue f WHERE f.filepath = q.filepath AND f.status = 'failed') AS first_failed_at
       FROM queue q
       WHERE q.status = 'failed'
         AND q.id = (SELECT MAX(l.id) FROM queue l WHERE l.filepath = q.filepath)
       ORDER BY q.completed_at DESC`
    )
    .all() as {
    id: number;
    filepath: string;
    error_message: string | null;
    completed_at: string;
    attempts: number;
    first_failed_at: string;
  }[];

  return rows
    .filter((row) => existsSync(row.filepath))
    .map((row) => ({
      queueId: row.id,
      filepath: row.filepath,
      filename: basename(row.filepath),
      attempts: row.attempts,
      firstFailedAt: row.first_failed_at,
      lastFailedAt: row.completed_at,
      error: row.error_message,
      ...explainFailure(row.error_message),
    }));
}

export function findProblem(queueId: number): QueueProblem {
  const problem = getQueueProblems().find((p) => p.queueId === queueId);
  if (!problem) throw new ProblemNotFoundError(queueId);
  return problem;
}

export class ProblemNotFoundError extends Error {
  constructor(queueId: number) {
    super(`No open problem for queue item ${queueId}`);
  }
}

/** Queues the file again with the original source and priority; returns the new queue id. */
export function retryProblem(queueId: number): number | null {
  const problem = findProblem(queueId);
  const original = getDatabase().prepare('SELECT * FROM queue WHERE id = ?').get(queueId) as QueueItem;
  return enqueueDocument(
    problem.filepath,
    original.source_type as QueueSourceType,
    original.source_metadata ? JSON.parse(original.source_metadata) : undefined,
    original.priority
  );
}

/**
 * Moves the file out of the drop folder into the graveyard (recoverable) and marks its
 * failed attempts dismissed, so the watcher won't pick it up again.
 */
export async function dismissProblem(queueId: number): Promise<string> {
  const problem = findProblem(queueId);
  const destination = await getUniqueFilename(join(CONFIG.graveyardDir, 'failed'), problem.filename);
  await safeMoveFile(problem.filepath, destination, async () => {
    getDatabase()
      .prepare(`UPDATE queue SET status = 'dismissed' WHERE filepath = ? AND status = 'failed'`)
      .run(problem.filepath);
  });
  return destination;
}

/**
 * Only one queue processor runs, so anything still marked processing at startup was
 * interrupted by a restart and would otherwise be stuck forever.
 */
export function resetInterruptedQueueItems(): number {
  return getDatabase()
    .prepare(`UPDATE queue SET status = 'pending', started_at = NULL WHERE status = 'processing'`)
    .run().changes;
}
