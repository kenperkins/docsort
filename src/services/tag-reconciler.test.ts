import { describe, it, expect } from 'vitest';
import {
  levenshteinDistance,
  similarity,
  normalizePath,
  findBestMatch,
} from './tag-reconciler.js';

describe('tag-reconciler', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return string length for empty comparison', () => {
      expect(levenshteinDistance('hello', '')).toBe(5);
      expect(levenshteinDistance('', 'world')).toBe(5);
    });

    it('should count single character difference', () => {
      expect(levenshteinDistance('hello', 'hallo')).toBe(1);
    });

    it('should count insertions', () => {
      expect(levenshteinDistance('helo', 'hello')).toBe(1);
    });

    it('should count deletions', () => {
      expect(levenshteinDistance('hello', 'helo')).toBe(1);
    });

    it('should handle completely different strings', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });
  });

  describe('similarity', () => {
    it('should return 1 for identical strings', () => {
      expect(similarity('hello', 'hello')).toBe(1);
    });

    it('should return 0 for empty string comparison', () => {
      expect(similarity('hello', '')).toBe(0);
      expect(similarity('', 'hello')).toBe(0);
    });

    it('should be case insensitive', () => {
      expect(similarity('Hello', 'hello')).toBe(1);
      expect(similarity('WORLD', 'world')).toBe(1);
    });

    it('should return high similarity for similar strings', () => {
      const sim = similarity('financial/taxes/2022', 'financial/taxes/2023');
      expect(sim).toBeGreaterThan(0.9);
    });

    it('should return low similarity for different strings', () => {
      const sim = similarity('financial/taxes', 'medical/records');
      expect(sim).toBeLessThan(0.5);
    });
  });

  describe('normalizePath', () => {
    it('should add leading slash if missing', () => {
      expect(normalizePath('financial/taxes')).toBe('/financial/taxes');
    });

    it('should preserve existing leading slash', () => {
      expect(normalizePath('/financial/taxes')).toBe('/financial/taxes');
    });

    it('should remove trailing slashes', () => {
      expect(normalizePath('/financial/taxes/')).toBe('/financial/taxes');
      expect(normalizePath('/financial/taxes///')).toBe('/financial/taxes');
    });

    it('should lowercase the path', () => {
      expect(normalizePath('/Financial/TAXES')).toBe('/financial/taxes');
    });

    it('should trim whitespace', () => {
      expect(normalizePath('  /financial/taxes  ')).toBe('/financial/taxes');
    });
  });

  describe('findBestMatch', () => {
    it('should match a trusted tag exactly', () => {
      expect(findBestMatch('/financial/taxes/forms')).toMatchObject({
        matchedPath: '/financial/taxes/forms',
        kind: 'exact',
      });
    });

    it('should ignore year segments', () => {
      expect(findBestMatch('/financial/taxes/forms/2019').matchedPath).toBe('/financial/taxes/forms');
    });

    it('should resolve an invented suffix to its trusted ancestor', () => {
      expect(findBestMatch('/financial/banking/first-tech/2016')).toMatchObject({
        matchedPath: '/financial/banking',
        kind: 'ancestor',
      });
    });

    it('should fuzzy-match a near miss', () => {
      expect(findBestMatch('/financial/credit-card')).toMatchObject({
        matchedPath: '/financial/credit-cards',
        kind: 'fuzzy',
      });
    });

    it('should never resolve to a bare root that is not trusted', () => {
      expect(findBestMatch('/financial/taxes').matchedPath).not.toBe('/financial');
    });

    it('should send unknown paths to needs-review', () => {
      expect(findBestMatch('/hobbies/underwater-basket-weaving')).toMatchObject({
        matchedPath: '/needs-review',
        kind: 'needs-review',
      });
    });
  });
});
