import { CONFIG } from '../lib/config.js';
import { getAllAliases, getPersonById, getPersonByAlias } from './database.js';
import type { Person } from '../lib/types.js';

/**
 * Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
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
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0-1).
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

/**
 * Normalize a name for comparison.
 * Lowercases, removes extra spaces, standardizes middle initial format.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\./g, ''); // Remove periods (J. -> J)
}

export interface PersonReconciliationResult {
  originalName: string;
  matchedPerson: Person | null;
  matchedAlias: string | null;
  similarity: number;
  isExactMatch: boolean;
}

/**
 * Find the best matching person for a given name.
 * Checks exact alias match first, then falls back to fuzzy matching.
 */
export function findPersonMatch(name: string): PersonReconciliationResult {
  if (!name || !name.trim()) {
    return {
      originalName: name,
      matchedPerson: null,
      matchedAlias: null,
      similarity: 0,
      isExactMatch: false,
    };
  }

  const normalizedInput = normalizeName(name);

  // First check for exact alias match (case-insensitive)
  const allAliases = getAllAliases();
  const exactMatch = allAliases.find(
    a => normalizeName(a.alias) === normalizedInput
  );

  if (exactMatch) {
    const person = getPersonById(exactMatch.person_id);
    return {
      originalName: name,
      matchedPerson: person,
      matchedAlias: exactMatch.alias,
      similarity: 1,
      isExactMatch: true,
    };
  }

  // Fall back to fuzzy matching
  let bestMatch: { person_id: number; alias: string } | null = null;
  let bestSimilarity = 0;

  for (const aliasEntry of allAliases) {
    const sim = similarity(normalizedInput, normalizeName(aliasEntry.alias));
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestMatch = aliasEntry;
    }
  }

  // Check if best match meets threshold
  const threshold = CONFIG.tagSimilarityThreshold; // Reuse tag threshold for now
  if (bestMatch && bestSimilarity >= threshold) {
    const person = getPersonById(bestMatch.person_id);
    return {
      originalName: name,
      matchedPerson: person,
      matchedAlias: bestMatch.alias,
      similarity: bestSimilarity,
      isExactMatch: false,
    };
  }

  return {
    originalName: name,
    matchedPerson: null,
    matchedAlias: null,
    similarity: bestSimilarity,
    isExactMatch: false,
  };
}

/**
 * Reconcile a person name against known persons.
 * Returns the person ID if matched, null otherwise.
 */
export function reconcilePerson(name: string): { personId: number | null; displayName: string | null; wasReconciled: boolean } {
  const result = findPersonMatch(name);

  if (result.matchedPerson) {
    console.log(
      `[PersonReconciler] Matched "${name}" → "${result.matchedPerson.display_name}" (${(result.similarity * 100).toFixed(0)}% via "${result.matchedAlias}")`
    );
    return {
      personId: result.matchedPerson.id,
      displayName: result.matchedPerson.display_name,
      wasReconciled: true,
    };
  }

  console.log(`[PersonReconciler] No match for "${name}" (best similarity: ${(result.similarity * 100).toFixed(0)}%)`);
  return {
    personId: null,
    displayName: null,
    wasReconciled: false,
  };
}

/**
 * Find potential person matches that could be linked.
 * Returns unlinked person names from documents with their best potential matches.
 */
export function findUnlinkedPersonNames(): Array<{
  name: string;
  documentCount: number;
  bestMatch: Person | null;
  similarity: number;
}> {
  // This would query documents where person_id is null but person text is not null
  // For now, return empty - could implement later for a "review unlinked" feature
  return [];
}
