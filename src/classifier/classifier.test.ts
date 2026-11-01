import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import Anthropic from '@anthropic-ai/sdk';
import { ClassifierConfigError, parseClassifierConfig, type ClassifierConfig } from './config.js';
import { createOpenAICompatibleProvider, extractJsonObject, toResponseSchema } from './openai-compatible.js';
import { createAnthropicProvider, isTransientAnthropicError } from './anthropic.js';
import { explainFailure } from '../services/queue-problems.js';
import { ProviderUnavailableError, type ClassifyRequest } from './provider.js';
import { buildClassificationSchema } from '../services/classification-schema.js';
import { backoffDelayMs } from '../services/queue-processor.js';

type OpenAIConfig = Extract<ClassifierConfig, { provider: 'openai-compatible' }>;

const ANSWER = {
  category: 'bill_invoice',
  tags: ['/financial/bills/utilities'],
  confidence: 0.9,
  suggested_filename: '2024-01-15_Water-Bill.pdf',
  metadata: { date: '2024-01-15' },
  summary: 'Water bill',
};

const request: ClassifyRequest = {
  pages: [Buffer.from('page-one'), Buffer.from('page-two')],
  prompt: 'Classify this.',
  schema: buildClassificationSchema(),
  documentName: 'scan.pdf',
};

// A stand-in for Ollama / vLLM / llama.cpp: records requests and replies however the test says.
let server: Server;
let baseUrl: string;
let lastRequest: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null;
let reply: { status: number; body: unknown; delayMs?: number } = { status: 200, body: {} };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      lastRequest = { headers: req.headers, body: JSON.parse(raw) };
      setTimeout(() => {
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function config(overrides: Record<string, string> = {}): OpenAIConfig {
  return parseClassifierConfig({
    CLASSIFIER: 'openai-compatible',
    CLASSIFIER_BASE_URL: baseUrl,
    CLASSIFIER_MODEL: 'qwen2.5vl:7b',
    ...overrides,
  }) as OpenAIConfig;
}

const completion = (content: string | null, extra: Record<string, unknown> = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content, ...extra } }],
});

describe('parseClassifierConfig', () => {
  it('defaults to anthropic with the current Sonnet at low effort', () => {
    expect(parseClassifierConfig({})).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low' });
  });

  it('rejects unknown providers and bad effort', () => {
    expect(() => parseClassifierConfig({ CLASSIFIER: 'ollama' })).toThrow(ClassifierConfigError);
    expect(() => parseClassifierConfig({ CLAUDE_EFFORT: 'extreme' })).toThrow(/CLAUDE_EFFORT/);
  });

  it('requires a URL and model for openai-compatible', () => {
    expect(() => parseClassifierConfig({ CLASSIFIER: 'openai-compatible', CLASSIFIER_MODEL: 'm' })).toThrow(/CLASSIFIER_BASE_URL/);
    expect(() => parseClassifierConfig({ CLASSIFIER: 'openai-compatible', CLASSIFIER_BASE_URL: 'http://x/v1' })).toThrow(/CLASSIFIER_MODEL/);
    expect(() => parseClassifierConfig({ CLASSIFIER: 'openai-compatible', CLASSIFIER_BASE_URL: 'ftp://x', CLASSIFIER_MODEL: 'm' })).toThrow(/http/);
    expect(() => config({ CLASSIFIER_JSON_MODE: 'grammar' })).toThrow(/JSON_MODE/);
  });

  it('accepts plain http for LAN inference servers', () => {
    expect(config().baseUrl.href).toBe(`${baseUrl}/`);
    expect(config()).toMatchObject({ jsonMode: 'schema', timeoutMs: 120_000, apiKey: undefined });
  });
});

describe('toResponseSchema', () => {
  it('is strict JSON Schema with tags limited to the tag list', () => {
    const schema = toResponseSchema(buildClassificationSchema(['/a', '/b'])) as {
      $schema?: string;
      additionalProperties: boolean;
      properties: { tags: { items: { enum: string[] } } };
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.tags.items.enum).toEqual(['/a', '/b']);
  });
});

describe('openai-compatible provider', () => {
  it('sends pages as data URIs with a strict response_format and the API key', async () => {
    reply = { status: 200, body: completion(JSON.stringify(ANSWER)) };
    const outcome = await createOpenAICompatibleProvider(config({ CLASSIFIER_API_KEY: 'k' })).classify(request);

    expect(outcome).toEqual({ kind: 'ok', raw: ANSWER });
    const body = lastRequest!.body as {
      model: string;
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(lastRequest!.headers.authorization).toBe('Bearer k');
    expect(body.model).toBe('qwen2.5vl:7b');
    expect(body.messages[0].content.map((c) => c.type)).toEqual(['image_url', 'image_url', 'text']);
    expect(body.messages[0].content[0].image_url!.url).toBe(`data:image/png;base64,${Buffer.from('page-one').toString('base64')}`);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
  });

  it('in prompt mode, describes the schema in the prompt and digs JSON out of prose', async () => {
    reply = { status: 200, body: completion(`Sure! Here it is:\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``) };
    const outcome = await createOpenAICompatibleProvider(config({ CLASSIFIER_JSON_MODE: 'prompt' })).classify(request);

    expect(outcome).toEqual({ kind: 'ok', raw: ANSWER });
    expect(lastRequest!.body.response_format).toBeUndefined();
    const text = (lastRequest!.body.messages as Array<{ content: Array<{ text?: string }> }>)[0].content.at(-1)!.text!;
    expect(text).toContain('JSON Schema');
    expect(lastRequest!.headers.authorization).toBeUndefined();
  });

  it('maps refusals, truncation and junk to declined/failed', async () => {
    const provider = createOpenAICompatibleProvider(config());
    reply = { status: 200, body: completion(null, { refusal: 'no' }) };
    expect(await provider.classify(request)).toMatchObject({ kind: 'declined' });
    reply = { status: 200, body: { choices: [{ finish_reason: 'length', message: { content: '{"cat' } }] } };
    expect(await provider.classify(request)).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/cut off/) });
    reply = { status: 200, body: completion('not json') };
    expect(await provider.classify(request)).toMatchObject({ kind: 'failed' });
    reply = { status: 400, body: { error: 'model does not support images' } };
    expect(await provider.classify(request)).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/HTTP 400/) });
  });

  it('treats 429/5xx, timeouts and refused connections as unavailable', async () => {
    reply = { status: 503, body: {} };
    await expect(createOpenAICompatibleProvider(config()).classify(request)).rejects.toBeInstanceOf(ProviderUnavailableError);

    reply = { status: 200, body: completion(JSON.stringify(ANSWER)), delayMs: 300 };
    await expect(createOpenAICompatibleProvider({ ...config(), timeoutMs: 50 }).classify(request)).rejects.toBeInstanceOf(ProviderUnavailableError);

    // Port 9 (discard) on loopback: nothing listens, so the connection is refused.
    const closed = parseClassifierConfig({ CLASSIFIER: 'openai-compatible', CLASSIFIER_BASE_URL: 'http://127.0.0.1:9/v1', CLASSIFIER_MODEL: 'm' }) as OpenAIConfig;
    await expect(createOpenAICompatibleProvider(closed).classify(request)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});

describe('extractJsonObject', () => {
  it('takes the outermost object', () => {
    expect(extractJsonObject('prefix {"a": {"b": 1}} suffix')).toEqual({ a: { b: 1 } });
    expect(() => extractJsonObject('no braces')).toThrow();
  });
});

describe('isTransientAnthropicError', () => {
  const apiError = (status: number) => Object.assign(Object.create(Anthropic.APIError.prototype), { status });

  it('retries rate limits, overload and connection errors, not bad requests', () => {
    expect(isTransientAnthropicError(apiError(429))).toBe(true);
    expect(isTransientAnthropicError(apiError(529))).toBe(true);
    expect(isTransientAnthropicError(apiError(400))).toBe(false);
    expect(isTransientAnthropicError(Object.create(Anthropic.APIConnectionError.prototype))).toBe(true);
    expect(isTransientAnthropicError(new Error('boom'))).toBe(false);
  });
});

describe('anthropic provider through the LLM proxy', () => {
  const provider = () =>
    createAnthropicProvider(
      { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low' },
      new Anthropic({ apiKey: 'sk-virtual', baseURL: baseUrl.replace(/\/v1$/, '/anthropic'), maxRetries: 0 })
    );
  const proxyError = (status: number, type: string, message: string) => ({
    status,
    body: { error: { message, type, param: null, code: String(status) } },
  });
  const failure = async () => {
    const err = await provider()
      .classify(request)
      .then(
        () => null,
        (e: Error) => e
      );
    expect(err).toBeInstanceOf(Error);
    return { err: err as Error, ...explainFailure((err as Error).message) };
  };

  it('sends no server-side fallback', async () => {
    reply = {
      status: 200,
      body: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [],
        stop_reason: 'refusal',
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    };
    await expect(provider().classify(request)).resolves.toMatchObject({ kind: 'declined' });
    expect(lastRequest?.body).not.toHaveProperty('fallbacks');
    expect(String(lastRequest?.headers['anthropic-beta'] ?? '')).not.toContain('fallback');
  });

  it('waits out a spent budget and explains it', async () => {
    reply = proxyError(429, 'budget_exceeded', 'Budget has been exceeded! Current cost: 25.01, Max budget: 25.0');
    const { err, reason } = await failure();
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(reason).toBe('The monthly AI budget is used up.');
  });

  it('blames the proxy, not the API key, for a model it won’t serve', async () => {
    reply = proxyError(403, 'permission_error', "The requested model 'claude-opus-5-5' is not available for this API key");
    expect((await failure()).reason).toBe('The AI proxy doesn’t allow this model.');
    reply = proxyError(403, 'permission_error', "model 'claude-opus-4-8' is not in the proxy's price list");
    expect((await failure()).reason).toBe('The AI proxy doesn’t allow this model.');
    reply = proxyError(403, 'permission_error', "model 'claude-opus-5-5' resolves to an ID missing from the proxy's price list");
    expect((await failure()).reason).toBe('The AI proxy doesn’t allow this model.');
  });

  it('labels the proxy’s own outages as temporary', async () => {
    reply = proxyError(503, 'service_unavailable', 'Service Unavailable, the authentication database is temporarily unreachable');
    expect((await failure()).reason).toContain('temporary');
    reply = proxyError(500, 'api_connection_error', 'Cannot connect to host api.anthropic.com:443');
    expect((await failure()).reason).toContain('temporary');
  });

  it('reports an unknown virtual key as a rejected key', async () => {
    reply = proxyError(401, 'token_not_found_in_db', 'Authentication Error, Invalid proxy server token passed.');
    expect((await failure()).reason).toContain('API key was rejected');
  });

  it('still explains Anthropic’s own rate limit as temporary', async () => {
    reply = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit' } } };
    expect((await failure()).reason).toContain('temporary');
  });
});

describe('backoffDelayMs', () => {
  it('doubles from 30s up to 10 minutes', () => {
    expect([1, 2, 3, 6, 50].map(backoffDelayMs)).toEqual([30_000, 60_000, 120_000, 600_000, 600_000]);
  });
});
