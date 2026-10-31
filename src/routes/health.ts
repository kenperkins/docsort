import { Router, type Router as RouterType } from 'express';
import { getQueueStats } from '../services/database.js';
import { isQueueProcessorRunning } from '../services/queue-processor.js';
import { isFileWatcherRunning } from '../services/file-watcher.js';
import { getMigrationStatus } from '../services/migrations.js';

const router: RouterType = Router();

router.get('/', (_req, res) => {
  const queueStats = getQueueStats();
  const queueProcessorRunning = isQueueProcessorRunning();
  const fileWatcherRunning = isFileWatcherRunning();

  const healthy = queueProcessorRunning && fileWatcherRunning;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    services: {
      queueProcessor: queueProcessorRunning ? 'running' : 'stopped',
      fileWatcher: fileWatcherRunning ? 'running' : 'stopped',
    },
    queue: queueStats,
  });
});

router.get('/ready', (_req, res) => {
  // Readiness check - are we ready to receive traffic?
  const queueProcessorRunning = isQueueProcessorRunning();
  const fileWatcherRunning = isFileWatcherRunning();

  if (queueProcessorRunning && fileWatcherRunning) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false });
  }
});

router.get('/live', (_req, res) => {
  // Liveness check - is the process alive?
  res.status(200).json({ alive: true });
});

router.get('/migrations', (_req, res) => {
  try {
    const status = getMigrationStatus();
    res.json(status);
  } catch (err) {
    console.error('Error getting migration status:', err);
    res.status(500).json({ error: 'Failed to get migration status' });
  }
});

export { router as healthRouter };
