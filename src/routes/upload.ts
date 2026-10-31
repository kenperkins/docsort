import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { CONFIG } from '../lib/config.js';
import { enqueueDocument } from '../services/database.js';
import { requireApiKey } from '../middleware/auth.js';
import type { QueueSourceType } from '../lib/types.js';

const router: RouterType = Router();

// Configure multer for memory storage (we'll write to incoming dir ourselves)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// Web upload endpoint (the logged-in web UI)
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    // The browser's MIME type is only a hint; check the bytes.
    if (!isPdf(req.file.buffer)) {
      return res.status(400).json({ error: 'File does not appear to be a PDF' });
    }

    const filename = sanitizeFilename(req.file.originalname);
    const filepath = await saveToUploadDir(req.file.buffer, filename);

    const queueId = enqueueDocument(filepath, 'web-upload', {
      originalName: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    });

    res.status(201).json({
      message: 'File uploaded and queued for processing',
      queueId,
      filename,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// API submission endpoint (requires API key)
router.post('/submit', requireApiKey, async (req, res) => {
  try {
    const { filename, content, sourceType, metadata } = req.body;

    // Content is the PDF itself, base64-encoded. The server never fetches URLs on a client's behalf.
    if (typeof filename !== 'string' || !filename || typeof content !== 'string' || !content) {
      return res.status(400).json({ error: 'filename and content (base64 PDF) are required' });
    }

    const buffer = Buffer.from(content, 'base64');
    if (!isPdf(buffer)) {
      return res.status(400).json({ error: 'File does not appear to be a PDF' });
    }

    const sanitizedFilename = sanitizeFilename(filename);
    const filepath = await saveToUploadDir(buffer, sanitizedFilename);

    const queueSourceType: QueueSourceType =
      (sourceType === 'remote-sync' || sourceType === 'api' || sourceType === 'email')
        ? sourceType
        : 'api';

    const queueId = enqueueDocument(filepath, queueSourceType, {
      ...(typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) ? metadata : {}),
      originalName: filename,
      size: buffer.length,
      submittedAt: new Date().toISOString(),
    });

    res.status(201).json({
      message: 'Document submitted and queued for processing',
      queueId,
      filename: sanitizedFilename,
    });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Failed to submit document' });
  }
});

function sanitizeFilename(name: string): string {
  // Remove path components and sanitize
  const base = basename(name);
  const sanitized = base
    .replace(/[^a-zA-Z0-9\s\-_.]/g, '_')
    .replace(/[\s_]+/g, '_')
    .slice(0, 100);

  // Ensure it ends with .pdf
  if (!sanitized.toLowerCase().endsWith('.pdf')) {
    return sanitized + '.pdf';
  }
  return sanitized;
}

async function saveToUploadDir(buffer: Buffer, filename: string): Promise<string> {
  // Ensure upload directory exists (separate from scanner's incoming dir)
  if (!existsSync(CONFIG.uploadDir)) {
    await mkdir(CONFIG.uploadDir, { recursive: true });
  }

  // Add UUID prefix to avoid collisions
  const uniqueFilename = `${randomUUID().slice(0, 8)}_${filename}`;
  const filepath = join(CONFIG.uploadDir, uniqueFilename);

  await writeFile(filepath, buffer);
  return filepath;
}

export { router as uploadRouter };

export function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}
