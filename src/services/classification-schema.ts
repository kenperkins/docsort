import { z } from 'zod';
import type { ClassificationResult, DocumentMetadata } from '../lib/types.js';
import { NEEDS_REVIEW_TAG, TRUSTED_TAGS, isTrustedTag } from '../lib/trusted-tags.js';

const optionalText = z.string().nullable();

const METADATA_FIELDS = [
  'client',
  'project_number',
  'person',
  'institution',
  'provider',
  'company',
  'party',
  'sender',
  'year',
  'subject',
  'document_type',
] as const;

/** The response shape Claude is constrained to; tags can only be paths from the tag list. */
export function buildClassificationSchema(tagPaths: string[] = Object.keys(TRUSTED_TAGS)) {
  return z.object({
    category: z.string(),
    tags: z.array(z.enum(tagPaths as [string, ...string[]])),
    confidence: z.number(),
    suggested_filename: z.string(),
    metadata: z.object({
      date: optionalText,
      date_precision: z.enum(['day', 'month', 'year']).nullable(),
      ...Object.fromEntries(METADATA_FIELDS.map((field) => [field, optionalText])),
    }),
    summary: z.string(),
  });
}

export type ClassificationSchema = ReturnType<typeof buildClassificationSchema>;
export type RawClassification = z.infer<ClassificationSchema>;

const DATE_PATTERN = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

export function needsReviewResult(filename: string, summary: string): ClassificationResult {
  return { category: 'other', tags: [NEEDS_REVIEW_TAG], confidence: 0, suggested_filename: filename, metadata: {}, summary };
}

/**
 * Structured outputs constrain the shape, but the values still come from a model reading
 * untrusted documents: clamp and check everything the filing step relies on.
 */
export function normalizeClassification(raw: unknown, fallbackFilename: string): ClassificationResult {
  if (typeof raw !== 'object' || raw === null) {
    return needsReviewResult(fallbackFilename, 'Classification response was empty');
  }
  const input = raw as Record<string, unknown>;

  const tags = [...new Set(Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === 'string' && isTrustedTag(t)) : [])].slice(0, 3);

  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? Math.min(1, Math.max(0, input.confidence)) : 0;

  const filename = typeof input.suggested_filename === 'string' && input.suggested_filename.trim() ? input.suggested_filename.trim() : fallbackFilename;

  const rawMeta = typeof input.metadata === 'object' && input.metadata !== null ? (input.metadata as Record<string, unknown>) : {};
  const metadata: DocumentMetadata = {};
  for (const field of METADATA_FIELDS) {
    const value = rawMeta[field];
    if (typeof value === 'string' && value.trim()) {
      metadata[field] = value.trim();
    }
  }
  if (typeof rawMeta.date === 'string' && DATE_PATTERN.test(rawMeta.date.trim())) {
    metadata.date = rawMeta.date.trim();
    metadata.date_precision = metadata.date.length === 10 ? 'day' : metadata.date.length === 7 ? 'month' : 'year';
  }

  return {
    category: typeof input.category === 'string' && input.category ? input.category : 'other',
    tags: tags.length > 0 ? tags : [NEEDS_REVIEW_TAG],
    confidence,
    suggested_filename: filename,
    metadata,
    summary: typeof input.summary === 'string' ? input.summary : '',
  };
}
