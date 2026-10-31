import { readFileSync } from 'fs';
import { parseTrustedProxies } from './ip.js';
import type { BlockList } from 'net';

export const NONE_MODE = 'none-i-understand-the-risk';

export interface RoleGroups {
  adminGroup: string;
  readerGroup?: string;
}

export type AuthConfig =
  | (RoleGroups & {
      mode: 'oidc';
      appUrl: URL;
      issuer: URL;
      clientId: string;
      clientSecret: string;
      sessionTtlMs: number;
      logoutUrl?: string;
    })
  | (RoleGroups & {
      mode: 'proxy';
      appUrl: URL;
      trustedProxies: BlockList;
      logoutUrl?: string;
    })
  | { mode: 'none' };

export class AuthConfigError extends Error {}

const HELP = `Set AUTH_MODE to one of:
  oidc     log in through an OpenID Connect provider (Authelia, Authentik, Keycloak, Google...).
           Needs APP_URL, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (or OIDC_CLIENT_SECRET_FILE).
  proxy    trust Remote-User / Remote-Groups headers from an authenticating reverse proxy.
           Needs APP_URL and TRUSTED_PROXIES (comma-separated CIDRs of the proxy).
  ${NONE_MODE}
           no authentication; listens on 127.0.0.1 only. For local development.`;

export function parseAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const mode = env.AUTH_MODE?.trim();

  if (!mode) {
    throw new AuthConfigError(`AUTH_MODE is not set. This app holds sensitive documents and won't start without authentication.\n${HELP}`);
  }
  if (mode === NONE_MODE) {
    return { mode: 'none' };
  }
  if (mode !== 'oidc' && mode !== 'proxy') {
    throw new AuthConfigError(`Unknown AUTH_MODE "${mode}".\n${HELP}`);
  }

  const appUrl = parseUrl(env, 'APP_URL');
  const roles: RoleGroups = {
    adminGroup: env.AUTH_ADMIN_GROUP?.trim() || 'admins',
    readerGroup: env.AUTH_READER_GROUP?.trim() || undefined,
  };
  const logoutUrl = env.AUTH_LOGOUT_URL ? parseUrl(env, 'AUTH_LOGOUT_URL').toString() : undefined;

  if (mode === 'proxy') {
    const cidrs = (env.TRUSTED_PROXIES ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    if (cidrs.length === 0) {
      throw new AuthConfigError('AUTH_MODE=proxy needs TRUSTED_PROXIES: the CIDRs the proxy connects from. Headers from anywhere else are ignored.');
    }
    let trustedProxies: BlockList;
    try {
      trustedProxies = parseTrustedProxies(cidrs);
    } catch (err) {
      throw new AuthConfigError(`TRUSTED_PROXIES: ${(err as Error).message}`);
    }
    return { mode, appUrl, trustedProxies, logoutUrl, ...roles };
  }

  const ttlHours = Number(env.SESSION_TTL_HOURS ?? '12');
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new AuthConfigError('SESSION_TTL_HOURS must be a positive number.');
  }

  return {
    mode,
    appUrl,
    issuer: parseUrl(env, 'OIDC_ISSUER'),
    clientId: required(env, 'OIDC_CLIENT_ID'),
    clientSecret: secret(env, 'OIDC_CLIENT_SECRET'),
    sessionTtlMs: ttlHours * 60 * 60 * 1000,
    logoutUrl,
    ...roles,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new AuthConfigError(`AUTH_MODE=${env.AUTH_MODE} needs ${name}.`);
  }
  return value;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const file = env[`${name}_FILE`]?.trim();
  if (file) {
    const value = readFileSync(file, 'utf-8').trim();
    if (!value) {
      throw new AuthConfigError(`${name}_FILE (${file}) is empty.`);
    }
    return value;
  }
  return required(env, name);
}

function parseUrl(env: NodeJS.ProcessEnv, name: string): URL {
  const raw = required(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AuthConfigError(`${name} is not a valid URL: ${raw}`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new AuthConfigError(`${name} must use https (http is allowed only for localhost): ${raw}`);
  }
  return url;
}
