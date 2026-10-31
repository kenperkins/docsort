#!/usr/bin/env node
/**
 * docsort sync agent
 *
 * A lightweight folder watcher that submits PDFs to the docsort API.
 * Run on any machine to sync local folders with your docsort server.
 *
 * Configuration via environment variables:
 *   WATCH_PATHS     - Comma-separated paths to watch (default: ~/Downloads)
 *   API_URL         - Doc-classifier API URL (required)
 *   API_KEY         - API key for authentication (required)
 *   DELETE_AFTER    - Delete files after successful upload (default: false)
 *   POLL_INTERVAL   - Debounce interval in ms (default: 2000)
 */

import chokidar from 'chokidar';
import { readFile, unlink } from 'fs/promises';
import { basename, resolve } from 'path';
import { homedir } from 'os';

const config = {
  watchPaths: (process.env.WATCH_PATHS || '~/Downloads')
    .split(',')
    .map((p) => p.trim().replace(/^~/, homedir())),
  apiUrl: process.env.API_URL,
  apiKey: process.env.API_KEY,
  deleteAfter: process.env.DELETE_AFTER === 'true',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '2000'),
};

// Validate required config
if (!config.apiUrl) {
  console.error('Error: API_URL environment variable is required');
  console.error('Example: API_URL=https://docsort.example.com/api/upload/submit');
  process.exit(1);
}

if (!config.apiKey) {
  console.error('Error: API_KEY environment variable is required');
  process.exit(1);
}

console.log('docsort sync agent');
console.log('='.repeat(40));
console.log(`Watching: ${config.watchPaths.join(', ')}`);
console.log(`API URL: ${config.apiUrl}`);
console.log(`Delete after upload: ${config.deleteAfter}`);
console.log('='.repeat(40));
console.log('');

const pendingFiles = new Map();

async function submitFile(filepath) {
  const filename = basename(filepath);
  console.log(`[Upload] Submitting: ${filename}`);

  try {
    const buffer = await readFile(filepath);
    const content = buffer.toString('base64');

    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
      body: JSON.stringify({
        filename,
        content,
        contentType: 'base64',
        sourceType: 'remote-sync',
        metadata: {
          sourcePath: filepath,
          hostname: process.env.HOSTNAME || 'unknown',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const result = await response.json();
    console.log(`[Upload] Success: ${filename} -> Queue ID ${result.queueId}`);

    if (config.deleteAfter) {
      await unlink(filepath);
      console.log(`[Upload] Deleted: ${filename}`);
    }
  } catch (err) {
    console.error(`[Upload] Failed: ${filename} - ${err.message}`);
  }
}

function handleFile(filepath) {
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
    clearTimeout(pendingFiles.get(filepath));
  }

  const timeout = setTimeout(() => {
    pendingFiles.delete(filepath);
    submitFile(filepath);
  }, config.pollInterval);

  pendingFiles.set(filepath, timeout);
}

// Start watching
const watcher = chokidar.watch(config.watchPaths, {
  persistent: true,
  ignoreInitial: true, // Don't process existing files on startup
  awaitWriteFinish: {
    stabilityThreshold: config.pollInterval,
    pollInterval: 100,
  },
  depth: 1, // Watch one level deep
});

watcher.on('add', handleFile);
watcher.on('change', handleFile);

watcher.on('error', (error) => {
  console.error('[Watcher] Error:', error);
});

watcher.on('ready', () => {
  console.log('[Watcher] Ready and watching for new PDFs...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  watcher.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Agent] Shutting down...');
  watcher.close();
  process.exit(0);
});
