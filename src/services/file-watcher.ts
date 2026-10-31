import chokidar from 'chokidar';
import { basename } from 'path';
import { CONFIG } from '../lib/config.js';
import { enqueueDocument } from './database.js';

let watcher: chokidar.FSWatcher | null = null;
const pendingFiles = new Map<string, NodeJS.Timeout>();

export function startFileWatcher(): void {
  if (watcher) return;

  console.log(`[FileWatcher] Watching: ${CONFIG.incomingDir}`);

  watcher = chokidar.watch(CONFIG.incomingDir, {
    persistent: true,
    ignoreInitial: false, // Process existing files on startup
    usePolling: true, // Required for NFS mounts
    interval: 5000, // Poll every 5 seconds
    awaitWriteFinish: {
      stabilityThreshold: CONFIG.watcherDebounceMs,
      pollInterval: 1000,
    },
    depth: 0, // Only watch top-level directory
  });

  watcher.on('add', (filepath) => {
    const filename = basename(filepath);

    // Only process PDF files
    if (!filename.toLowerCase().endsWith('.pdf')) {
      return;
    }

    // Skip hidden files
    if (filename.startsWith('.')) {
      return;
    }

    // Debounce to handle rapid file updates
    if (pendingFiles.has(filepath)) {
      clearTimeout(pendingFiles.get(filepath)!);
    }

    const timeout = setTimeout(() => {
      pendingFiles.delete(filepath);
      console.log(`[FileWatcher] New file detected: ${filename}`);
      enqueueDocument(filepath, 'scanner', { filename });
    }, 500);

    pendingFiles.set(filepath, timeout);
  });

  watcher.on('error', (error) => {
    console.error('[FileWatcher] Error:', error);
  });

  watcher.on('ready', () => {
    console.log('[FileWatcher] Ready');
  });
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[FileWatcher] Stopped');
  }

  // Clear any pending timeouts
  for (const timeout of pendingFiles.values()) {
    clearTimeout(timeout);
  }
  pendingFiles.clear();
}

export function isFileWatcherRunning(): boolean {
  return watcher !== null;
}
