import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ClassifierConfig } from './config.js';
import { ProviderUnavailableError, type ClassifierProvider, type ClassifyRequest, type ClassifyOutcome } from './provider.js';

type AnthropicConfig = Extract<ClassifierConfig, { provider: 'anthropic' }>;

// Models that take the server-side refusal fallback ("default" picks the fallback model).
const SERVER_FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);

/** Worth waiting out rather than failing the document. The SDK has already retried by now. */
export function isTransientAnthropicError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) {
    return true;
  }
  return err instanceof Anthropic.APIError && typeof err.status === 'number' && (err.status === 429 || err.status >= 500);
}

export function createAnthropicProvider(config: AnthropicConfig, client: Anthropic = new Anthropic()): ClassifierProvider {
  return {
    description: `anthropic (${config.model}, effort ${config.effort})`,

    async classify({ pages, prompt, schema, documentName }: ClassifyRequest): Promise<ClassifyOutcome> {
      const images: Anthropic.Beta.BetaImageBlockParam[] = pages.map((page) => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: page.toString('base64') },
      }));

      let response;
      try {
        response = await client.beta.messages.parse({
          model: config.model,
          max_tokens: 8192,
          // Thinking stays at the model default; low effort keeps routine classification cheap.
          output_config: { effort: config.effort, format: betaZodOutputFormat(schema) },
          ...(SERVER_FALLBACK_MODELS.has(config.model)
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
          messages: [{ role: 'user', content: [...images, { type: 'text', text: prompt }] }],
        });
      } catch (err) {
        if (isTransientAnthropicError(err)) {
          throw new ProviderUnavailableError(`Anthropic API unavailable: ${(err as Error).message}`, { cause: err });
        }
        throw err;
      }

      if (response.stop_reason === 'refusal') {
        return { kind: 'declined', reason: `declined (${response.stop_details?.category ?? 'no category'})` };
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        return { kind: 'failed', reason: `no usable answer for ${documentName} (stop_reason: ${response.stop_reason})` };
      }
      return { kind: 'ok', raw: response.parsed_output };
    },
  };
}
