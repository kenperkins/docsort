export const CONFIG = {
  port: parseInt(process.env.PORT || '3000'),
  incomingDir: process.env.INCOMING_DIR || '/data/incoming',
  uploadDir: process.env.UPLOAD_DIR || '/data/uploads',
  outputBase: process.env.OUTPUT_DIR || '/data/documents',
  needsReviewDir: process.env.REVIEW_DIR || '/data/documents/needs-review',
  graveyardDir: process.env.GRAVEYARD_DIR || '/data/graveyard',
  logDir: process.env.LOG_DIR || '/data/documents/processed-log',
  dbPath: process.env.DB_PATH || '/data/docsort.db',
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7'),
  maxPages: parseInt(process.env.MAX_PAGES || '3'),
  // Queue processor settings
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000'),
  // File watcher debounce (wait for file to be fully written)
  watcherDebounceMs: parseInt(process.env.WATCHER_DEBOUNCE_MS || '2000'),
  // Tag reconciliation - similarity threshold (0-1) for matching existing tags
  tagSimilarityThreshold: parseFloat(process.env.TAG_SIMILARITY_THRESHOLD || '0.85'),
};
