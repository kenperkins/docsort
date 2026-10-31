import { z } from 'zod';
import type { ClassifierConfig } from './config.js';
import type { ClassificationSchema } from '../services/classification-schema.js';
import { ProviderUnavailableError, type ClassifierProvider, type ClassifyRequest, type ClassifyOutcome } from './provider.js';

type OpenAICompatibleConfig = Extract<ClassifierConfig, { provider: 'openai-compatible' }>;

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
}

/** JSON Schema for response_format. The $schema dialect marker is dropped; some servers reject it. */
export function toResponseSchema(schema: ClassificationSchema): Record<string, unknown> {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return jsonSchema;
}

/** Models without constrained decoding wrap JSON in prose or code fences. Take the outermost object. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('no JSON object in the response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

export function buildChatRequest(config: OpenAICompatibleConfig, request: ClassifyRequest): Record<string, unknown> {
  const responseSchema = toResponseSchema(request.schema);
  const prompt =
    config.jsonMode === 'prompt'
      ? `${request.prompt}\n\nReply with only a JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(responseSchema)}`
      : request.prompt;

  return {
    model: config.model,
    max_tokens: 4096,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          ...request.pages.map((page) => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${page.toString('base64')}` },
          })),
          { type: 'text', text: prompt },
        ],
      },
    ],
    ...(config.jsonMode === 'schema'
      ? { response_format: { type: 'json_schema', json_schema: { name: 'classification', strict: true, schema: responseSchema } } }
      : {}),
  };
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch = fetch,
): ClassifierProvider {
  const endpoint = new URL('chat/completions', config.baseUrl);

  return {
    description: `openai-compatible (${config.model} at ${config.baseUrl.origin}, json ${config.jsonMode})`,

    async classify(request: ClassifyRequest): Promise<ClassifyOutcome> {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify(buildChatRequest(config, request)),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (err) {
        // Refused, unreachable, DNS, or our timeout: the endpoint, not the document.
        throw new ProviderUnavailableError(`${endpoint.origin} unreachable: ${(err as Error).message}`, { cause: err });
      }

      if (response.status === 429 || response.status >= 500) {
        throw new ProviderUnavailableError(`${endpoint.origin} returned ${response.status}`);
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        return { kind: 'failed', reason: `HTTP ${response.status} from ${endpoint.origin}: ${body}` };
      }

      let data: ChatCompletionResponse;
      try {
        data = (await response.json()) as ChatCompletionResponse;
      } catch {
        return { kind: 'failed', reason: 'response was not JSON' };
      }

      const choice = data.choices?.[0];
      if (choice?.message?.refusal) {
        return { kind: 'declined', reason: choice.message.refusal };
      }
      if (choice?.finish_reason === 'length') {
        return { kind: 'failed', reason: `answer for ${request.documentName} was cut off (max_tokens)` };
      }
      const content = choice?.message?.content;
      if (!content) {
        return { kind: 'failed', reason: 'empty answer' };
      }

      try {
        return { kind: 'ok', raw: config.jsonMode === 'schema' ? JSON.parse(content) : extractJsonObject(content) };
      } catch (err) {
        return { kind: 'failed', reason: `answer wasn't valid JSON: ${(err as Error).message}` };
      }
    },
  };
}
