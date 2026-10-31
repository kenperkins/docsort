import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

// Keys for machine clients (the sync agent). They only unlock POST /api/upload/submit.
const API_KEYS = (process.env.API_KEYS || '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);
const API_KEY_HASHES = API_KEYS.map(digest);

export const MIN_API_KEY_LENGTH = 32;

/** A reason to refuse to start, or null. Short keys are guessable against an internet-facing endpoint. */
export function apiKeyProblem(keys: string[] = API_KEYS): string | null {
  const short = keys.filter((key) => key.length < MIN_API_KEY_LENGTH).length;
  return short ? `${short} of API_KEYS is shorter than ${MIN_API_KEY_LENGTH} characters; generate keys with: openssl rand -hex 32` : null;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function isValidApiKey(candidate: string, keyHashes: Buffer[] = API_KEY_HASHES): boolean {
  const candidateHash = digest(candidate);
  return keyHashes.some((hash) => timingSafeEqual(hash, candidateHash));
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'];

  if (typeof apiKey !== 'string' || !apiKey) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  if (!isValidApiKey(apiKey)) {
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
