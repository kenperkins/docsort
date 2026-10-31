import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { BadQueryError, queryInt, queryString } from './query.js';
import { buildClassificationSchema, normalizeClassification } from '../services/classification-schema.js';
import { NEEDS_REVIEW_TAG } from './trusted-tags.js';
import { apiKeyProblem } from '../middleware/auth.js';
import { isPdf } from '../routes/upload.js';
import { securityHeaders } from '../middleware/security.js';

const reqWith = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

describe('query helpers', () => {
  it('reject repeated parameters', () => {
    expect(() => queryString(reqWith({ category: ['a', 'b'] }), 'category')).toThrow(BadQueryError);
    expect(queryString(reqWith({ category: 'a' }), 'category')).toBe('a');
    expect(queryString(reqWith({}), 'category')).toBeUndefined();
  });

  it('clamp numbers', () => {
    const opts = { min: 1, max: 200, fallback: 50 };
    expect(queryInt(reqWith({ limit: '-1' }), 'limit', opts)).toBe(1);
    expect(queryInt(reqWith({ limit: '100000' }), 'limit', opts)).toBe(200);
    expect(queryInt(reqWith({}), 'limit', opts)).toBe(50);
    expect(() => queryInt(reqWith({ limit: 'lots' }), 'limit', opts)).toThrow(BadQueryError);
  });
});

describe('normalizeClassification', () => {
  const good = {
    category: 'bill_invoice',
    tags: ['/financial/bills/utilities', '/financial/bills/utilities', '/not/a/tag'],
    confidence: 1.7,
    suggested_filename: '2024-01-15_Water-Bill.pdf',
    metadata: { date: '2024-01-15', date_precision: 'year', company: '  City Water ', person: null },
    summary: 'January water bill',
  };

  it('keeps valid values and fixes the rest', () => {
    const result = normalizeClassification(good, 'scan.pdf');
    expect(result.tags).toEqual(['/financial/bills/utilities']);
    expect(result.confidence).toBe(1);
    expect(result.metadata).toEqual({ date: '2024-01-15', date_precision: 'day', company: 'City Water' });
  });

  it('survives missing or wrong-typed fields', () => {
    const result = normalizeClassification({ suggested_filename: null, metadata: 'nope', confidence: 'high', tags: 'x' }, 'scan.pdf');
    expect(result).toMatchObject({ suggested_filename: 'scan.pdf', confidence: 0, tags: [NEEDS_REVIEW_TAG], metadata: {} });
    expect(normalizeClassification(null, 'scan.pdf').tags).toEqual([NEEDS_REVIEW_TAG]);
  });

  it('drops dates that are not real ISO dates', () => {
    for (const date of ['2024-13-01', 'January 2024', '24-01-15', '2024-01-15T00:00']) {
      expect(normalizeClassification({ ...good, metadata: { date } }, 'scan.pdf').metadata.date, date).toBeUndefined();
    }
  });
});

describe('classification schema', () => {
  it('only accepts tags from the tag list', () => {
    const schema = buildClassificationSchema(['/a', '/b']);
    const base = { category: 'x', confidence: 0.8, suggested_filename: 'f.pdf', summary: 's', metadata: { date: null, date_precision: null } };
    const meta = Object.fromEntries(['client', 'project_number', 'person', 'institution', 'provider', 'company', 'party', 'sender', 'year', 'subject', 'document_type'].map((k) => [k, null]));
    expect(schema.safeParse({ ...base, metadata: { ...base.metadata, ...meta }, tags: ['/a'] }).success).toBe(true);
    expect(schema.safeParse({ ...base, metadata: { ...base.metadata, ...meta }, tags: ['/c'] }).success).toBe(false);
  });
});

describe('isPdf', () => {
  it('checks the magic bytes, not the name or MIME type', () => {
    expect(isPdf(Buffer.from('%PDF-1.7\n...'))).toBe(true);
    expect(isPdf(Buffer.from('<html>%PDF-'))).toBe(false);
    expect(isPdf(Buffer.alloc(0))).toBe(false);
  });
});

describe('apiKeyProblem', () => {
  it('refuses short keys', () => {
    expect(apiKeyProblem(['a'.repeat(64)])).toBeNull();
    expect(apiKeyProblem(['a'.repeat(64), 'secret'])).toMatch(/1 of API_KEYS/);
    expect(apiKeyProblem([])).toBeNull();
  });
});

describe('securityHeaders', () => {
  it('sets a strict CSP that allows the logout redirect', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
    securityHeaders('https://auth.example.com/logout')({} as Request, res, () => {});
    expect(headers['Content-Security-Policy']).toContain("script-src 'self'");
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("form-action 'self' https://auth.example.com");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
});
