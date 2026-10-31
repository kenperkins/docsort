import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// CONFIG reads the environment at import time, so point it at a scratch area first.
const root = mkdtempSync(join(tmpdir(), 'queue-problems-'));
process.env.DB_PATH = join(root, 'test.db');
process.env.GRAVEYARD_DIR = join(root, 'graveyard');
const incoming = join(root, 'incoming');

const { getDatabase, closeDatabase } = await import('./database.js');
const { explainFailure, getQueueProblems, findProblem, retryProblem, dismissProblem, resetInterruptedQueueItems, ProblemNotFoundError } = await import(
  './queue-problems.js'
);

function addRow(file: string, status: string, error: string | null = null): number {
  return getDatabase()
    .prepare(
      `INSERT INTO queue (filepath, source_type, status, error_message, completed_at)
       VALUES (?, 'scanner', ?, ?, CURRENT_TIMESTAMP)`
    )
    .run(join(incoming, file), status, error).lastInsertRowid as number;
}

function touch(file: string) {
  writeFileSync(join(incoming, file), 'pdf');
}

describe('queue problems', () => {
  beforeAll(() => {
    mkdirSync(incoming, { recursive: true });

    touch('later-worked.pdf');
    addRow('later-worked.pdf', 'failed', 'Expected DOMMatrix');
    addRow('later-worked.pdf', 'completed');

    touch('still-broken.pdf');
    addRow('still-broken.pdf', 'failed', 'Invalid PDF structure.');
    addRow('still-broken.pdf', 'failed', 'Invalid PDF structure.');

    addRow('gone.pdf', 'failed', 'Invalid PDF structure.');

    touch('retrying.pdf');
    addRow('retrying.pdf', 'failed', 'overloaded_error');
    addRow('retrying.pdf', 'pending');

    touch('stuck.pdf');
    addRow('stuck.pdf', 'processing');
  });

  afterAll(() => {
    closeDatabase();
    rmSync(root, { recursive: true, force: true });
  });

  it('should list only files whose latest attempt failed and that are still on disk', () => {
    const problems = getQueueProblems();
    expect(problems.map((p) => p.filename)).toEqual(['still-broken.pdf']);
    expect(problems[0]).toMatchObject({ attempts: 2, reason: expect.stringContaining('damaged') });
  });

  it('should only resolve queue ids that are open problems', () => {
    const [problem] = getQueueProblems();
    expect(findProblem(problem.queueId).filepath).toContain('still-broken.pdf');
    const completedId = (getDatabase().prepare(`SELECT id FROM queue WHERE status = 'completed'`).get() as { id: number }).id;
    expect(() => findProblem(completedId)).toThrow(ProblemNotFoundError);
  });

  it('should re-queue items left processing by a restart', () => {
    expect(resetInterruptedQueueItems()).toBe(1);
    const row = getDatabase().prepare(`SELECT status FROM queue WHERE filepath LIKE '%stuck.pdf'`).get() as {
      status: string;
    };
    expect(row.status).toBe('pending');
  });

  it('should retry by queueing the file again', () => {
    const [problem] = getQueueProblems();
    expect(retryProblem(problem.queueId)).toEqual(expect.any(Number));
    expect(getQueueProblems()).toEqual([]);
  });

  it('should move a dismissed file to the graveyard and drop it from the list', async () => {
    touch('dismiss-me.pdf');
    const id = addRow('dismiss-me.pdf', 'failed', 'Invalid PDF structure.');
    const movedTo = await dismissProblem(id);

    expect(existsSync(join(incoming, 'dismiss-me.pdf'))).toBe(false);
    expect(existsSync(movedTo)).toBe(true);
    expect(movedTo).toContain(join('graveyard', 'failed'));
    expect(getQueueProblems()).toEqual([]);
  });
});

describe('explainFailure', () => {
  it('should translate known API and PDF errors', () => {
    expect(explainFailure('400 {"message":"image exceeds 5 MB maximum: 1 bytes > 2 bytes"}').reason).toContain('too large');
    expect(explainFailure('Your credit balance is too low to access the Anthropic API').reason).toContain('out of credit');
    expect(explainFailure('404 {"type":"not_found_error","message":"model: claude-x"}').reason).toContain('no longer available');
    expect(explainFailure('529 overloaded_error').reason).toContain('temporary');
  });

  it('should fall back to a generic message', () => {
    expect(explainFailure('something odd')).toEqual({
      reason: 'Classification failed.',
      hint: 'Check the details, then retry.',
    });
  });
});
