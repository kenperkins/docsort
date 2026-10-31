import type { ClassificationSchema } from '../services/classification-schema.js';

export interface ClassifyRequest {
  /** PNG renders of the first pages. */
  pages: Buffer[];
  prompt: string;
  /** The shape the answer must have; providers turn it into whatever their API constrains with. */
  schema: ClassificationSchema;
  /** For log lines only. */
  documentName: string;
}

/**
 * `raw` is unvalidated model output: normalizeClassification always runs on it, whatever
 * the provider claims about schema adherence.
 */
export type ClassifyOutcome =
  | { kind: 'ok'; raw: unknown }
  | { kind: 'declined'; reason: string }
  | { kind: 'failed'; reason: string };

export interface ClassifierProvider {
  readonly description: string;
  classify(request: ClassifyRequest): Promise<ClassifyOutcome>;
}

/**
 * The endpoint can't be reached right now (down, asleep, rate limited, timed out). The
 * document isn't the problem: the queue puts it back and tries again later.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}
