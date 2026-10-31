import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { computeFileHash } from './duplicate-detector.js';

const TEST_DIR = '/tmp/docsort-dup-test';

describe('duplicate-detector', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('computeFileHash', () => {
    it('should compute consistent SHA256 hash for same content', async () => {
      const testFile = join(TEST_DIR, 'test.pdf');
      await writeFile(testFile, 'test content');

      const hash1 = await computeFileHash(testFile);
      const hash2 = await computeFileHash(testFile);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex is 64 chars
    });

    it('should produce different hashes for different content', async () => {
      const file1 = join(TEST_DIR, 'file1.pdf');
      const file2 = join(TEST_DIR, 'file2.pdf');
      await writeFile(file1, 'content one');
      await writeFile(file2, 'content two');

      const hash1 = await computeFileHash(file1);
      const hash2 = await computeFileHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash for identical files with different names', async () => {
      const file1 = join(TEST_DIR, 'original.pdf');
      const file2 = join(TEST_DIR, 'copy.pdf');
      const content = 'identical content';
      await writeFile(file1, content);
      await writeFile(file2, content);

      const hash1 = await computeFileHash(file1);
      const hash2 = await computeFileHash(file2);

      expect(hash1).toBe(hash2);
    });
  });
});
