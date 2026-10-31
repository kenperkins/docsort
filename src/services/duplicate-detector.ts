import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { getDatabase } from './database.js';

export interface DuplicateMatch {
  documentId: number;
  filepath: string;
  similarity: number; // 1 = exact match
}

/**
 * Compute SHA256 hash of a file
 */
export async function computeFileHash(filepath: string): Promise<string> {
  const content = await readFile(filepath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Find documents with matching file hash (exact duplicates)
 */
export function findDuplicatesByHash(fileHash: string): DuplicateMatch[] {
  const db = getDatabase();

  const matches = db.prepare(`
    SELECT id, filepath FROM documents
    WHERE file_hash = ?
  `).all(fileHash) as { id: number; filepath: string }[];

  return matches.map(m => ({
    documentId: m.id,
    filepath: m.filepath,
    similarity: 1,
  }));
}

/**
 * Check if a file is an exact duplicate of an existing document
 */
export async function checkForDuplicate(filepath: string): Promise<{
  isDuplicate: boolean;
  fileHash: string;
  match?: DuplicateMatch;
}> {
  const fileHash = await computeFileHash(filepath);
  const matches = findDuplicatesByHash(fileHash);

  if (matches.length > 0) {
    return {
      isDuplicate: true,
      fileHash,
      match: matches[0],
    };
  }

  return { isDuplicate: false, fileHash };
}
