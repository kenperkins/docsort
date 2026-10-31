import { readFileSync } from 'fs';
import defaultTags from './trusted-tags.json' with { type: 'json' };

export const NEEDS_REVIEW_TAG = '/needs-review';

/** Tag path -> description. The classifier may only use these; TAGS_FILE replaces the built-in list. */
export function parseTagsFile(json: string): Record<string, string> {
  const data: unknown = JSON.parse(json);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('expected a JSON object of "/tag/path": "description"');
  }
  const tags: Record<string, string> = {};
  for (const [path, description] of Object.entries(data)) {
    if (!/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(path) || typeof description !== 'string') {
      throw new Error(`invalid tag "${path}": paths look like /area/sub-area (lowercase, digits, dashes) with a string description`);
    }
    tags[path] = description;
  }
  tags[NEEDS_REVIEW_TAG] ??= 'Nothing else fits; a person should look at it';
  return tags;
}

function loadTags(file = process.env.TAGS_FILE): Readonly<Record<string, string>> {
  if (!file) {
    return defaultTags;
  }
  const tags = parseTagsFile(readFileSync(file, 'utf-8'));
  console.log(`[Tags] Using ${Object.keys(tags).length} tags from ${file}`);
  return tags;
}

export const TRUSTED_TAGS: Readonly<Record<string, string>> = loadTags();

export function isTrustedTag(path: string): boolean {
  return Object.hasOwn(TRUSTED_TAGS, path);
}

export function trustedTagPromptList(): string {
  return Object.entries(TRUSTED_TAGS)
    .map(([path, description]) => `${path} - ${description}`)
    .join('\n');
}
