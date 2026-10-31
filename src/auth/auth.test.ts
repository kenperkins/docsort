import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { AuthConfigError, NONE_MODE, parseAuthConfig, type AuthConfig } from './config.js';
import { isTrustedAddress, parseTrustedProxies } from './ip.js';
import { cookieNames, requireAuth, requireSameOrigin, roleFor } from './middleware.js';
import { decodePendingLogin, encodePendingLogin, safeReturnTo } from './routes.js';
import { SessionStore, createAuthSessionsTable } from './sessions.js';
import { isValidApiKey } from '../middleware/auth.js';

const OIDC_ENV = {
  AUTH_MODE: 'oidc',
  APP_URL: 'https://docs.example.com',
  OIDC_ISSUER: 'https://auth.example.com',
  OIDC_CLIENT_ID: 'docsort',
  OIDC_CLIENT_SECRET: 's3cret',
};

const PROXY_ENV = {
  AUTH_MODE: 'proxy',
  APP_URL: 'https://docs.example.com',
  TRUSTED_PROXIES: '10.42.0.0/16',
};

function fakeReq(init: { method?: string; headers?: Record<string, string>; remoteAddress?: string } = {}): Request {
  return {
    method: init.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    socket: { remoteAddress: init.remoteAddress },
  } as unknown as Request;
}

function run(handler: ReturnType<typeof requireAuth>, req: Request) {
  const result = { status: 200, body: undefined as unknown, nextCalled: false };
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  } as unknown as Response;
  handler(req, res, () => {
    result.nextCalled = true;
  });
  return result;
}

describe('parseAuthConfig', () => {
  it('refuses to start without AUTH_MODE', () => {
    expect(() => parseAuthConfig({})).toThrow(AuthConfigError);
    expect(() => parseAuthConfig({})).toThrow(/won't start without authentication/);
  });

  it('rejects unknown modes, including a plain "none"', () => {
    expect(() => parseAuthConfig({ AUTH_MODE: 'none' })).toThrow(/Unknown AUTH_MODE/);
    expect(() => parseAuthConfig({ AUTH_MODE: 'off' })).toThrow(/Unknown AUTH_MODE/);
  });

  it('allows no auth only with the explicit opt-out', () => {
    expect(parseAuthConfig({ AUTH_MODE: NONE_MODE })).toEqual({ mode: 'none' });
  });

  it('parses oidc with defaults', () => {
    const config = parseAuthConfig(OIDC_ENV);
    expect(config).toMatchObject({ mode: 'oidc', clientId: 'docsort', clientSecret: 's3cret', adminGroup: 'admins' });
    expect(config.mode === 'oidc' && config.sessionTtlMs).toBe(12 * 60 * 60 * 1000);
  });

  it('requires every oidc setting', () => {
    for (const key of ['APP_URL', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']) {
      const env: Record<string, string> = { ...OIDC_ENV };
      delete env[key];
      expect(() => parseAuthConfig(env), key).toThrow(new RegExp(key));
    }
  });

  it('reads the client secret from a file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'auth-test-')), 'secret');
    writeFileSync(file, 'from-file\n');
    const env: Record<string, string> = { ...OIDC_ENV, OIDC_CLIENT_SECRET_FILE: file };
    delete env.OIDC_CLIENT_SECRET;
    expect(parseAuthConfig(env)).toMatchObject({ clientSecret: 'from-file' });
  });

  it('requires https except on localhost', () => {
    expect(() => parseAuthConfig({ ...OIDC_ENV, APP_URL: 'http://docs.example.com' })).toThrow(/https/);
    expect(parseAuthConfig({ ...OIDC_ENV, APP_URL: 'http://localhost:3000' })).toMatchObject({ mode: 'oidc' });
  });

  it('requires valid trusted proxies for proxy mode', () => {
    expect(() => parseAuthConfig({ ...PROXY_ENV, TRUSTED_PROXIES: '' })).toThrow(/TRUSTED_PROXIES/);
    expect(() => parseAuthConfig({ ...PROXY_ENV, TRUSTED_PROXIES: '10.42.0.0/40' })).toThrow(/invalid CIDR/);
    expect(parseAuthConfig({ ...PROXY_ENV, AUTH_READER_GROUP: 'family' })).toMatchObject({ mode: 'proxy', readerGroup: 'family' });
  });
});

describe('trusted proxies', () => {
  const list = parseTrustedProxies(['10.42.0.0/16', 'fd00::/8', '192.0.2.7']);

  it('matches IPv4, IPv4-mapped IPv6 and IPv6 addresses in range', () => {
    expect(isTrustedAddress(list, '10.42.3.4')).toBe(true);
    expect(isTrustedAddress(list, '::ffff:10.42.3.4')).toBe(true);
    expect(isTrustedAddress(list, 'fd00::1')).toBe(true);
    expect(isTrustedAddress(list, '192.0.2.7')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isTrustedAddress(list, '10.43.0.1')).toBe(false);
    expect(isTrustedAddress(list, '::ffff:192.168.1.1')).toBe(false);
    expect(isTrustedAddress(list, undefined)).toBe(false);
    expect(isTrustedAddress(list, 'not-an-ip')).toBe(false);
  });
});

describe('roleFor', () => {
  it('prefers admin, falls back to reader, else nothing', () => {
    const roles = { adminGroup: 'admins', readerGroup: 'family' };
    expect(roleFor(['family', 'admins'], roles)).toBe('admin');
    expect(roleFor(['family'], roles)).toBe('reader');
    expect(roleFor(['other'], roles)).toBeNull();
    expect(roleFor(['family'], { adminGroup: 'admins' })).toBeNull();
  });
});

describe('requireAuth in proxy mode', () => {
  const config = parseAuthConfig({ ...PROXY_ENV, AUTH_READER_GROUP: 'family' });
  const handler = requireAuth(config);
  const fromProxy = (headers: Record<string, string>, method = 'GET') =>
    fakeReq({ method, headers, remoteAddress: '::ffff:10.42.1.2' });

  it('accepts identity headers from the proxy', () => {
    const req = fromProxy({ 'Remote-User': 'alex', 'Remote-Groups': 'admins,family', 'Remote-Email': 'alex@example.com' });
    const result = run(handler, req);
    expect(result.nextCalled).toBe(true);
    expect(req.user).toMatchObject({ subject: 'alex', role: 'admin', email: 'alex@example.com' });
  });

  it('ignores identity headers from anywhere else', () => {
    const req = fakeReq({ headers: { 'Remote-User': 'alex', 'Remote-Groups': 'admins' }, remoteAddress: '192.0.2.50' });
    expect(run(handler, req)).toMatchObject({ status: 401, nextCalled: false });
  });

  it('treats an empty Remote-User as unauthenticated', () => {
    expect(run(handler, fromProxy({ 'Remote-User': '', 'Remote-Groups': 'admins' }))).toMatchObject({ status: 401 });
  });

  it('refuses users outside the allowed groups', () => {
    expect(run(handler, fromProxy({ 'Remote-User': 'guest', 'Remote-Groups': 'guests' }))).toMatchObject({ status: 403 });
  });

  it('keeps readers read-only', () => {
    const headers = { 'Remote-User': 'kid', 'Remote-Groups': 'family' };
    expect(run(handler, fromProxy(headers, 'GET')).nextCalled).toBe(true);
    expect(run(handler, fromProxy(headers, 'DELETE'))).toMatchObject({ status: 403, nextCalled: false });
  });
});

describe('requireAuth in oidc mode', () => {
  it('authenticates by session cookie only', () => {
    const db = new Database(':memory:');
    createAuthSessionsTable(db);
    const sessions = new SessionStore(db);
    const config = parseAuthConfig(OIDC_ENV) as AuthConfig;
    const handler = requireAuth(config, sessions);
    const token = sessions.create({ subject: 'alex', groups: ['admins'] }, 60_000);

    const withCookie = fakeReq({ headers: { cookie: `other=1; __Host-docsort_session=${token}` } });
    expect(run(handler, withCookie).nextCalled).toBe(true);
    expect(withCookie.user).toMatchObject({ subject: 'alex', role: 'admin' });

    expect(run(handler, fakeReq({ headers: { cookie: `__Host-docsort_session=forged` } }))).toMatchObject({ status: 401 });
    // Proxy headers mean nothing in oidc mode, even from a "trusted" address.
    const headersOnly = fakeReq({ headers: { 'Remote-User': 'alex', 'Remote-Groups': 'admins' }, remoteAddress: '10.42.0.1' });
    expect(run(handler, headersOnly)).toMatchObject({ status: 401 });
  });
});

describe('requireSameOrigin', () => {
  const handler = requireSameOrigin('https://docs.example.com');

  it('lets safe methods through', () => {
    expect(run(handler, fakeReq({ headers: { origin: 'https://evil.example' } })).nextCalled).toBe(true);
  });

  it('allows same-origin writes', () => {
    const req = fakeReq({ method: 'POST', headers: { origin: 'https://docs.example.com', 'sec-fetch-site': 'same-origin' } });
    expect(run(handler, req).nextCalled).toBe(true);
  });

  it('refuses cross-origin and same-site writes', () => {
    expect(run(handler, fakeReq({ method: 'DELETE', headers: { origin: 'https://evil.example' } }))).toMatchObject({ status: 403 });
    // A sibling app on the parent domain: same-site, so a Lax cookie would be sent.
    const sibling = fakeReq({ method: 'POST', headers: { origin: 'https://rimworld.example.com', 'sec-fetch-site': 'same-site' } });
    expect(run(handler, sibling)).toMatchObject({ status: 403 });
  });
});

describe('SessionStore', () => {
  it('expires sessions and stores only token hashes', () => {
    const db = new Database(':memory:');
    createAuthSessionsTable(db);
    const now = vi.fn(() => 1_000);
    const store = new SessionStore(db, now);
    const token = store.create({ subject: 'alex', name: 'Alex', groups: ['admins'] }, 500);

    expect(store.get(token)).toEqual({ subject: 'alex', name: 'Alex', email: undefined, groups: ['admins'] });
    const stored = db.prepare('SELECT token_hash FROM auth_sessions').pluck().all() as string[];
    expect(stored).toEqual([createHash('sha256').update(token).digest('hex')]);

    now.mockReturnValue(1_500);
    expect(store.get(token)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) FROM auth_sessions').pluck().get()).toBe(0);
  });

  it('logs out by deleting the session', () => {
    const db = new Database(':memory:');
    createAuthSessionsTable(db);
    const store = new SessionStore(db);
    const token = store.create({ subject: 'alex', groups: [] }, 60_000);
    store.delete(token);
    expect(store.get(token)).toBeNull();
  });
});

describe('safeReturnTo', () => {
  it('keeps same-app paths and drops anything that could leave the app', () => {
    expect(safeReturnTo('/documents/4?x=1')).toBe('/documents/4?x=1');
    expect(safeReturnTo('//evil.example/')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});

describe('isValidApiKey', () => {
  it('matches configured keys only', () => {
    const hashes = ['key-one', 'key-two'].map((k) => createHash('sha256').update(k).digest());
    expect(isValidApiKey('key-two', hashes)).toBe(true);
    expect(isValidApiKey('key-three', hashes)).toBe(false);
    expect(isValidApiKey('anything', [])).toBe(false);
  });
});

describe('cookies', () => {
  it('use __Host- names on https only', () => {
    expect(cookieNames(new URL('https://docs.example.com'))).toEqual({ session: '__Host-docsort_session', login: '__Host-docsort_login' });
    expect(cookieNames(new URL('http://localhost:3000'))).toEqual({ session: 'docsort_session', login: 'docsort_login' });
  });

  it('ignores a session cookie without the __Host- prefix on https', () => {
    const db = new Database(':memory:');
    createAuthSessionsTable(db);
    const sessions = new SessionStore(db);
    const handler = requireAuth(parseAuthConfig(OIDC_ENV), sessions);
    const token = sessions.create({ subject: 'alex', groups: ['admins'] }, 60_000);
    // A sibling subdomain can set docsort_session on the parent domain, but not __Host-docsort_session.
    expect(run(handler, fakeReq({ headers: { cookie: `docsort_session=${token}` } }))).toMatchObject({ status: 401 });
  });
});

describe('pending login cookie', () => {
  const login = { state: 's', codeVerifier: 'v', nonce: 'n', returnTo: '/documents/3' };

  it('round-trips', () => {
    expect(decodePendingLogin(encodePendingLogin(login))).toEqual(login);
  });

  it('rejects garbage, missing fields, and unsafe returnTo', () => {
    expect(decodePendingLogin(undefined)).toBeNull();
    expect(decodePendingLogin('not-base64-json')).toBeNull();
    expect(decodePendingLogin(encodePendingLogin({ ...login, nonce: '' }))).toBeNull();
    expect(decodePendingLogin(encodePendingLogin({ ...login, returnTo: '//evil.example' }))?.returnTo).toBe('/');
  });
});
