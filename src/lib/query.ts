import type { Request } from 'express';

export class BadQueryError extends Error {}

/** One string, or undefined. Repeated parameters (?a=1&a=2) arrive as arrays and are rejected. */
export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadQueryError(`${name} must be given once`);
  }
  return value;
}

export function queryInt(req: Request, name: string, opts: { min: number; max: number; fallback: number }): number {
  const raw = queryString(req, name);
  if (raw === undefined || raw === '') {
    return opts.fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new BadQueryError(`${name} must be a number`);
  }
  return Math.min(opts.max, Math.max(opts.min, value));
}
