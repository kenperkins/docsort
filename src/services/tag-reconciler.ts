import { CONFIG } from '../lib/config.js';
import { getAllTags, ensureTagPath } from './database.js';
import { TRUSTED_TAGS, NEEDS_REVIEW_TAG, isTrustedTag } from '../lib/trusted-tags.js';
import type { Tag } from '../lib/types.js';

/**
 * Levenshtein distance between two strings.
 * Returns the minimum number of single-character edits needed.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0-1).
 * 1 = identical, 0 = completely different.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

/**
 * Normalize a tag path for comparison.
 * Lowercases, trims, ensures leading slash.
 */
export function normalizePath(path: string): string {
  let normalized = path.trim().toLowerCase();
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  return normalized.replace(/\/+$/, ''); // remove trailing slashes
}

const YEAR_SEGMENT = /^(19|20)\d{2}([-_]\d{2})?$/;

function stripYearSegments(path: string): string {
  const segments = path.split('/').filter((s) => s && !YEAR_SEGMENT.test(s));
  return '/' + segments.join('/');
}

export type MatchKind = 'exact' | 'ancestor' | 'fuzzy' | 'needs-review';

export interface ReconciliationResult {
  originalPath: string;
  matchedPath: string;
  similarity: number;
  kind: MatchKind;
}

/**
 * Resolve a suggested path to a trusted tag. Never invents a tag: anything that
 * can't be matched lands on /needs-review.
 *
 * Order: exact match, then nearest trusted ancestor (so a model-added suffix like
 * /financial/taxes/forms/1099-int still resolves), then fuzzy match on the full path.
 */
export function findBestMatch(suggestedPath: string): ReconciliationResult {
  const normalized = stripYearSegments(normalizePath(suggestedPath));
  const result = (matchedPath: string, sim: number, kind: MatchKind): ReconciliationResult => ({
    originalPath: suggestedPath,
    matchedPath,
    similarity: sim,
    kind,
  });

  if (isTrustedTag(normalized)) {
    return result(normalized, 1, 'exact');
  }

  const segments = normalized.split('/').filter(Boolean);
  for (let i = segments.length - 1; i > 0; i--) {
    const ancestor = '/' + segments.slice(0, i).join('/');
    if (isTrustedTag(ancestor)) {
      return result(ancestor, similarity(normalized, ancestor), 'ancestor');
    }
  }

  let bestPath = NEEDS_REVIEW_TAG;
  let bestSimilarity = 0;
  for (const trusted of Object.keys(TRUSTED_TAGS)) {
    const sim = similarity(normalized, trusted);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestPath = trusted;
    }
  }

  if (bestSimilarity >= CONFIG.tagSimilarityThreshold) {
    return result(bestPath, bestSimilarity, 'fuzzy');
  }
  return result(NEEDS_REVIEW_TAG, bestSimilarity, 'needs-review');
}

export interface ReconciledTag {
  tagId: number;
  originalPath: string;
  matchedPath: string;
  wasReconciled: boolean;
}

/**
 * Reconcile suggested paths to trusted tag IDs, preserving order (first = primary).
 * Duplicates collapse, and /needs-review is dropped when any other tag resolved.
 */
export function reconcileTags(suggestedPaths: string[]): ReconciledTag[] {
  const resolved: ReconciledTag[] = [];
  for (const path of suggestedPaths) {
    const match = findBestMatch(path);
    if (match.kind !== 'exact') {
      console.log(`[TagReconciler] ${match.kind}: "${path}" → "${match.matchedPath}"`);
    }
    if (resolved.some((r) => r.matchedPath === match.matchedPath)) continue;
    resolved.push({
      tagId: ensureTagPath(match.matchedPath),
      originalPath: path,
      matchedPath: match.matchedPath,
      wasReconciled: match.kind !== 'exact',
    });
  }

  const trusted = resolved.filter((r) => r.matchedPath !== NEEDS_REVIEW_TAG);
  if (trusted.length > 0) return trusted;
  return resolved.length > 0
    ? resolved
    : [{ tagId: ensureTagPath(NEEDS_REVIEW_TAG), originalPath: '', matchedPath: NEEDS_REVIEW_TAG, wasReconciled: true }];
}

/**
 * Find potential duplicate tags that could be merged.
 * Returns pairs of tags with similarity above threshold.
 */
export function findPotentialDuplicates(threshold?: number): Array<{ tag1: Tag; tag2: Tag; similarity: number }> {
  const minSimilarity = threshold ?? CONFIG.tagSimilarityThreshold;
  const tags = getAllTags();
  const duplicates: Array<{ tag1: Tag; tag2: Tag; similarity: number }> = [];

  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const sim = similarity(
        normalizePath(tags[i].full_path),
        normalizePath(tags[j].full_path)
      );
      if (sim >= minSimilarity && sim < 1) {
        duplicates.push({
          tag1: tags[i],
          tag2: tags[j],
          similarity: sim,
        });
      }
    }
  }

  return duplicates.sort((a, b) => b.similarity - a.similarity);
}
