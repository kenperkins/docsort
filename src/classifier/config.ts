import { readFileSync } from 'fs';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export type ClassifierConfig =
  | { provider: 'anthropic'; model: string; effort: Effort }
  | {
      provider: 'openai-compatible';
      baseUrl: URL;
      model: string;
      apiKey?: string;
      /** schema: the server constrains output to the JSON Schema. prompt: the schema is only described in the prompt. */
      jsonMode: 'schema' | 'prompt';
      timeoutMs: number;
    };

export class ClassifierConfigError extends Error {}

const HELP = `Set CLASSIFIER to one of:
  anthropic          Claude through Anthropic's API (default). ANTHROPIC_API_KEY; optional CLAUDE_MODEL, CLAUDE_EFFORT.
  openai-compatible  Any server with an OpenAI-style /v1/chat/completions endpoint that accepts images:
                     Ollama, llama.cpp server, vLLM, LM Studio, LocalAI, or a gateway such as LiteLLM.
                     CLASSIFIER_BASE_URL (e.g. http://ollama:11434/v1), CLASSIFIER_MODEL; optional
                     CLASSIFIER_API_KEY or CLASSIFIER_API_KEY_FILE, CLASSIFIER_JSON_MODE (schema|prompt),
                     CLASSIFIER_TIMEOUT_SECONDS (120).`;

export function parseClassifierConfig(env: NodeJS.ProcessEnv): ClassifierConfig {
  const provider = env.CLASSIFIER?.trim() || 'anthropic';

  if (provider === 'anthropic') {
    const effort = (env.CLAUDE_EFFORT?.trim() || 'low') as Effort;
    if (!EFFORT_LEVELS.includes(effort)) {
      throw new ClassifierConfigError(`CLAUDE_EFFORT must be one of ${EFFORT_LEVELS.join(', ')}.`);
    }
    return { provider, model: env.CLAUDE_MODEL?.trim() || 'claude-sonnet-5-5', effort };
  }

  if (provider !== 'openai-compatible') {
    throw new ClassifierConfigError(`Unknown CLASSIFIER "${provider}".\n${HELP}`);
  }

  const rawUrl = env.CLASSIFIER_BASE_URL?.trim();
  if (!rawUrl) {
    throw new ClassifierConfigError(`CLASSIFIER=openai-compatible needs CLASSIFIER_BASE_URL.\n${HELP}`);
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`);
  } catch {
    throw new ClassifierConfigError(`CLASSIFIER_BASE_URL is not a valid URL: ${rawUrl}`);
  }
  // Local inference servers usually speak plain http on the LAN; anything else is a mistake.
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new ClassifierConfigError(`CLASSIFIER_BASE_URL must be http or https: ${rawUrl}`);
  }

  const model = env.CLASSIFIER_MODEL?.trim();
  if (!model) {
    throw new ClassifierConfigError(`CLASSIFIER=openai-compatible needs CLASSIFIER_MODEL.\n${HELP}`);
  }

  const jsonMode = env.CLASSIFIER_JSON_MODE?.trim() || 'schema';
  if (jsonMode !== 'schema' && jsonMode !== 'prompt') {
    throw new ClassifierConfigError('CLASSIFIER_JSON_MODE must be "schema" or "prompt".');
  }

  const timeoutSeconds = Number(env.CLASSIFIER_TIMEOUT_SECONDS ?? '120');
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new ClassifierConfigError('CLASSIFIER_TIMEOUT_SECONDS must be a positive number.');
  }

  const keyFile = env.CLASSIFIER_API_KEY_FILE?.trim();
  const apiKey = keyFile ? readFileSync(keyFile, 'utf-8').trim() : env.CLASSIFIER_API_KEY?.trim() || undefined;

  return { provider, baseUrl, model, apiKey, jsonMode, timeoutMs: timeoutSeconds * 1000 };
}
