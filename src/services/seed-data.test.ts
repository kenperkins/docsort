import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parsePeopleFile } from './seed-data.js';
import { parseTagsFile, NEEDS_REVIEW_TAG } from '../lib/trusted-tags.js';

describe('parsePeopleFile', () => {
  it('reads the shipped example', () => {
    const people = parsePeopleFile(readFileSync(new URL('../../people.example.json', import.meta.url), 'utf-8'));
    expect(people).toHaveLength(2);
    expect(people[0]).toMatchObject({ displayName: 'Alex', isFamily: true });
  });

  it('defaults aliases and isFamily', () => {
    expect(parsePeopleFile('[{"displayName":"Sam","canonicalName":"Samuel Rivera","isFamily":false}]')).toEqual([
      { displayName: 'Sam', canonicalName: 'Samuel Rivera', aliases: [], isFamily: false },
    ]);
  });

  it('rejects malformed entries', () => {
    expect(() => parsePeopleFile('{}')).toThrow(/array/);
    expect(() => parsePeopleFile('[{"displayName":"Sam"}]')).toThrow(/entry 0/);
    expect(() => parsePeopleFile('[{"displayName":"Sam","canonicalName":"S","aliases":"Sammy"}]')).toThrow(/aliases/);
  });
});

describe('parseTagsFile', () => {
  it('accepts a custom taxonomy and always keeps the review tag', () => {
    const tags = parseTagsFile('{"/finance/bank": "Bank statements", "/home": "House stuff"}');
    expect(Object.keys(tags)).toEqual(['/finance/bank', '/home', NEEDS_REVIEW_TAG]);
  });

  it('rejects paths the folder layout can\'t use', () => {
    expect(() => parseTagsFile('{"finance": "x"}')).toThrow(/invalid tag/);
    expect(() => parseTagsFile('{"/Finance/Bank": "x"}')).toThrow(/invalid tag/);
    expect(() => parseTagsFile('{"/finance/../etc": "x"}')).toThrow(/invalid tag/);
    expect(() => parseTagsFile('["/finance"]')).toThrow(/JSON object/);
  });
});
