import { createAnthropicProvider } from './anthropic.js';
import { parseClassifierConfig, type ClassifierConfig } from './config.js';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import type { ClassifierProvider } from './provider.js';

export { ProviderUnavailableError } from './provider.js';
export { ClassifierConfigError, parseClassifierConfig } from './config.js';

export function createProvider(config: ClassifierConfig): ClassifierProvider {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider(config);
    case 'openai-compatible':
      return createOpenAICompatibleProvider(config);
  }
}

let provider: ClassifierProvider | null = null;

/** The configured provider. index.ts parses the config at startup, so errors surface there first. */
export function getProvider(): ClassifierProvider {
  provider ??= createProvider(parseClassifierConfig(process.env));
  return provider;
}
