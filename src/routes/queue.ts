import { Router, type Router as RouterType } from 'express';
import { BadQueryError, queryInt } from '../lib/query.js';
import { sendPdf } from '../middleware/security.js';
import { getQueueStats, getRecentQueueItems } from '../services/database.js';
import { getClassifierUnavailable, isQueuePaused, setQueuePaused } from '../services/queue-processor.js';
import {
  getQueueProblems,
  explainFailure,
  findProblem,
  retryProblem,
  dismissProblem,
  ProblemNotFoundError,
} from '../services/queue-problems.js';

const router: RouterType = Router();

// Get queue stats
router.get('/stats', (_req, res) => {
  try {
    const unavailable = getClassifierUnavailable();
    res.json({
      ...getQueueStats(),
      needsAttention: getQueueProblems().length,
      classifierUnavailable: unavailable && { ...unavailable, ...explainFailure(unavailable.error) },
    });
  } catch (err) {
    console.error('Error getting queue stats:', err);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});

// Get recent queue items
router.get('/recent', (req, res) => {
  try {
    const limit = queryInt(req, 'limit', { min: 1, max: 200, fallback: 50 });
    const items = getRecentQueueItems(limit);
    res.json(items);
  } catch (err) {
    if (err instanceof BadQueryError) return res.status(400).json({ error: err.message });
    console.error('Error getting queue items:', err);
    res.status(500).json({ error: 'Failed to get queue items' });
  }
});

router.get('/problems', (_req, res) => {
  try {
    res.json(getQueueProblems());
  } catch (err) {
    console.error('Error getting queue problems:', err);
    res.status(500).json({ error: 'Failed to get queue problems' });
  }
});

// Serves only files that are currently open problems, looked up by queue id, never by path.
router.get('/problems/:id/file', (req, res) => {
  try {
    const problem = findProblem(parseInt(req.params.id, 10));
    sendPdf(res, problem.filepath, problem.filename, req.query.download !== undefined);
  } catch (err) {
    if (err instanceof ProblemNotFoundError) return res.status(404).json({ error: err.message });
    console.error('Error serving problem file:', err);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

router.post('/problems/:id/retry', (req, res) => {
  try {
    const queueId = retryProblem(parseInt(req.params.id, 10));
    res.json({ queued: queueId !== null, queueId });
  } catch (err) {
    if (err instanceof ProblemNotFoundError) return res.status(404).json({ error: err.message });
    console.error('Error retrying queue item:', err);
    res.status(500).json({ error: 'Failed to retry' });
  }
});

router.post('/problems/:id/dismiss', async (req, res) => {
  try {
    const movedTo = await dismissProblem(parseInt(req.params.id, 10));
    res.json({ movedTo });
  } catch (err) {
    if (err instanceof ProblemNotFoundError) return res.status(404).json({ error: err.message });
    console.error('Error dismissing queue item:', err);
    res.status(500).json({ error: 'Failed to move file to graveyard' });
  }
});

router.get('/paused', (_req, res) => {
  res.json({ paused: isQueuePaused() });
});

router.post('/pause', (_req, res) => {
  setQueuePaused(true);
  res.json({ paused: true });
});

router.post('/resume', (_req, res) => {
  setQueuePaused(false);
  res.json({ paused: false });
});

export { router as queueRouter };
