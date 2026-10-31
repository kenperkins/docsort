import express from 'express';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './lib/config.js';
import { getDatabase, closeDatabase } from './services/database.js';
import { seedPeople } from './services/seed-data.js';
import { runMigrations } from './services/migrations.js';
import { resetInterruptedQueueItems } from './services/queue-problems.js';
import { startQueueProcessor, stopQueueProcessor } from './services/queue-processor.js';
import { startFileWatcher, stopFileWatcher } from './services/file-watcher.js';
import { healthRouter } from './routes/health.js';
import { documentsRouter } from './routes/documents.js';
import { queueRouter } from './routes/queue.js';
import { uploadRouter } from './routes/upload.js';
import { reviewRouter } from './routes/review.js';
import tagsRouter from './routes/tags.js';
import personsRouter from './routes/persons.js';
import { AuthConfigError, parseAuthConfig, type AuthConfig } from './auth/config.js';
import { requireAuth, requireSameOrigin } from './auth/middleware.js';
import { createAuthRouter } from './auth/routes.js';
import { SessionStore } from './auth/sessions.js';
import { apiKeyProblem } from './middleware/auth.js';
import { securityHeaders } from './middleware/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let authConfig: AuthConfig;
try {
  authConfig = parseAuthConfig(process.env);
} catch (err) {
  if (err instanceof AuthConfigError) {
    console.error(`[Server] Refusing to start: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const keyProblem = apiKeyProblem();
if (keyProblem) {
  console.error(`[Server] Refusing to start: ${keyProblem}`);
  process.exit(1);
}

// A fresh volume has none of the working folders yet.
for (const dir of [CONFIG.incomingDir, CONFIG.uploadDir, CONFIG.outputBase, CONFIG.needsReviewDir, CONFIG.graveyardDir, CONFIG.logDir, path.dirname(CONFIG.dbPath)]) {
  mkdirSync(dir, { recursive: true });
}

// Initialize database
console.log('[Server] Initializing database...');
getDatabase();

// Run pending migrations
runMigrations();

const sessions = authConfig.mode === 'oidc' ? new SessionStore(getDatabase()) : undefined;
const appOrigin = authConfig.mode === 'none' ? undefined : authConfig.appUrl.origin;

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders(authConfig.mode === 'none' ? undefined : authConfig.logoutUrl));

app.use(express.json({ limit: '50mb' }));

// Unauthenticated: liveness/readiness for probes, and the sync agent's upload (API key instead).
// Everything else under /api, including detailed health and migration status, needs a login.
const PUBLIC_ROUTES = new Set(['GET /health/live', 'GET /health/ready', 'POST /upload/submit']);

app.use('/auth', createAuthRouter(authConfig, sessions));

const authenticate = requireAuth(authConfig, sessions);
const sameOrigin = requireSameOrigin(appOrigin);
app.use('/api', (req, res, next) => {
  if (PUBLIC_ROUTES.has(`${req.method} ${req.path.toLowerCase()}`)) {
    next();
    return;
  }
  authenticate(req, res, (err?: unknown) => (err ? next(err) : sameOrigin(req, res, next)));
});

app.get('/api/me', (req, res) => {
  const { name, email, role, subject } = req.user!;
  res.json({ subject, name, email, role, mode: authConfig.mode, canLogout: authConfig.mode !== 'none' });
});

// API routes
app.use('/api/health', healthRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/queue', queueRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/review', reviewRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/persons', personsRouter);

// Serve frontend static files in production. The shell is public; all data comes from /api.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));

  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    }
  });
}

const interrupted = resetInterruptedQueueItems();
if (interrupted > 0) {
  console.log(`[Server] Re-queued ${interrupted} item(s) interrupted by the last shutdown`);
}

// Seed people from PEOPLE_FILE on first run
seedPeople();

// Start services
console.log('[Server] Starting file watcher...');
startFileWatcher();

console.log('[Server] Starting queue processor...');
startQueueProcessor();

const sessionPurge = sessions ? setInterval(() => sessions.purgeExpired(), 60 * 60 * 1000) : undefined;

// Start HTTP server. With auth disabled, only this machine can reach it.
const onListening = () => {
  console.log(`[Server] docsort running on port ${CONFIG.port} (auth: ${authConfig.mode})`);
  if (authConfig.mode === 'none') {
    console.warn('[Server] AUTH_MODE=none-i-understand-the-risk: no authentication, listening on 127.0.0.1 only');
  }
};
const server =
  authConfig.mode === 'none' ? app.listen(CONFIG.port, '127.0.0.1', onListening) : app.listen(CONFIG.port, onListening);

// Graceful shutdown
function shutdown() {
  console.log('[Server] Shutting down...');

  stopFileWatcher();
  stopQueueProcessor();
  clearInterval(sessionPurge);

  server.close(() => {
    closeDatabase();
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('[Server] Forced shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
