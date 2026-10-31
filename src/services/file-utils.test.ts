import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { safeMoveFile, getUniqueFilename, tagPathToFolder, documentYear } from './file-utils.js';

const TEST_DIR = '/tmp/docsort-test';
const SOURCE_DIR = join(TEST_DIR, 'source');
const DEST_DIR = join(TEST_DIR, 'dest');

describe('file-utils', () => {
  beforeEach(async () => {
    await mkdir(SOURCE_DIR, { recursive: true });
    await mkdir(DEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('getUniqueFilename', () => {
    it('should return original path if file does not exist', async () => {
      const result = await getUniqueFilename(DEST_DIR, 'test.pdf');
      expect(result).toBe(join(DEST_DIR, 'test.pdf'));
    });

    it('should append _1 if file exists', async () => {
      await writeFile(join(DEST_DIR, 'test.pdf'), 'existing');

      const result = await getUniqueFilename(DEST_DIR, 'test.pdf');
      expect(result).toBe(join(DEST_DIR, 'test_1.pdf'));
    });

    it('should append _2 if _1 also exists', async () => {
      await writeFile(join(DEST_DIR, 'test.pdf'), 'existing');
      await writeFile(join(DEST_DIR, 'test_1.pdf'), 'existing');

      const result = await getUniqueFilename(DEST_DIR, 'test.pdf');
      expect(result).toBe(join(DEST_DIR, 'test_2.pdf'));
    });

    it('should handle multiple collisions', async () => {
      await writeFile(join(DEST_DIR, 'test.pdf'), 'existing');
      await writeFile(join(DEST_DIR, 'test_1.pdf'), 'existing');
      await writeFile(join(DEST_DIR, 'test_2.pdf'), 'existing');

      const result = await getUniqueFilename(DEST_DIR, 'test.pdf');
      expect(result).toBe(join(DEST_DIR, 'test_3.pdf'));
    });
  });

  describe('safeMoveFile', () => {
    it('should move file and run callback', async () => {
      const sourceFile = join(SOURCE_DIR, 'source.pdf');
      const destFile = join(DEST_DIR, 'dest.pdf');
      const content = 'test content';
      await writeFile(sourceFile, content);

      let callbackRan = false;
      await safeMoveFile(sourceFile, destFile, async () => {
        callbackRan = true;
      });

      expect(callbackRan).toBe(true);

      // Source should be deleted
      await expect(access(sourceFile)).rejects.toThrow();

      // Dest should exist with same content
      const destContent = await readFile(destFile, 'utf-8');
      expect(destContent).toBe(content);
    });

    it('should preserve source file if callback fails', async () => {
      const sourceFile = join(SOURCE_DIR, 'source.pdf');
      const destFile = join(DEST_DIR, 'dest.pdf');
      const content = 'test content';
      await writeFile(sourceFile, content);

      await expect(
        safeMoveFile(sourceFile, destFile, async () => {
          throw new Error('Callback failed');
        })
      ).rejects.toThrow('Callback failed');

      // Source should still exist
      const sourceContent = await readFile(sourceFile, 'utf-8');
      expect(sourceContent).toBe(content);

      // Dest should be cleaned up
      await expect(access(destFile)).rejects.toThrow();
    });

    it('should create destination directory if needed', async () => {
      const sourceFile = join(SOURCE_DIR, 'source.pdf');
      const nestedDest = join(DEST_DIR, 'a', 'b', 'c', 'dest.pdf');
      await writeFile(sourceFile, 'content');

      await safeMoveFile(sourceFile, nestedDest, async () => {});

      const destContent = await readFile(nestedDest, 'utf-8');
      expect(destContent).toBe('content');
    });
  });

  describe('tagPathToFolder', () => {
    it('should append the year below the tag path', () => {
      expect(tagPathToFolder('/financial/taxes/forms', '/docs', '2019')).toBe('/docs/financial/taxes/forms/2019');
    });

    it('should omit the year when unknown', () => {
      expect(tagPathToFolder('/financial/taxes/forms', '/docs', null)).toBe('/docs/financial/taxes/forms');
    });

    it('should never add a year under needs-review', () => {
      expect(tagPathToFolder('/needs-review', '/docs', '2019')).toBe('/docs/needs-review');
    });
  });

  describe('documentYear', () => {
    it('should prefer the explicit year', () => {
      expect(documentYear({ year: '2018', date: '2019-02-01' })).toBe('2018');
    });

    it('should fall back to the date', () => {
      expect(documentYear({ date: '2019-02' })).toBe('2019');
    });

    it('should fall back to the filename date prefix', () => {
      expect(documentYear({}, '2019-06-25_Grade-1-Report-Card.pdf')).toBe('2019');
      expect(documentYear({}, 'undated_Medical-Records.pdf')).toBeNull();
      expect(documentYear({ year: '', date: 'undated' }, '2019-06-25_Grade-1-Report-Card.pdf')).toBe('2019');
    });

    it('should reject non-year values', () => {
      expect(documentYear({ year: '2017-2019', date: 'undated' })).toBeNull();
    });
  });
});
