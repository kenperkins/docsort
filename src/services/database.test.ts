import { describe, it, expect } from 'vitest';
import { toFtsQuery } from './database.js';

describe('toFtsQuery', () => {
  it('should quote each word as a prefix term', () => {
    expect(toFtsQuery('mortgage statement')).toBe('"mortgage"* "statement"*');
  });

  it('should keep FTS operators inside quotes so they match literally', () => {
    expect(toFtsQuery('1099-INT')).toBe('"1099-INT"*');
    expect(toFtsQuery('water OR sewer')).toBe('"water"* "OR"* "sewer"*');
  });

  it('should strip double quotes from user input', () => {
    expect(toFtsQuery('"W2')).toBe('"W2"*');
  });

  it('should return null for blank input', () => {
    expect(toFtsQuery('   ')).toBeNull();
  });
});
