import { Router, type Request, type Response, type Router as RouterType } from 'express';
import * as oidc from 'openid-client';
import type { AuthConfig } from './config.js';
import { cookieNames, readCookie, requireSameOrigin, roleFor } from './middleware.js';
import type { SessionStore } from './sessions.js';

type OidcAuthConfig = Extract<AuthConfig, { mode: 'oidc' }>;

interface PendingLogin {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/** Only same-app paths: "/x" but not "//host" or "/\host", which browsers treat as other origins. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}

export function encodePendingLogin(login: PendingLogin): string {
  return Buffer.from(JSON.stringify(login)).toString('base64url');
}

export function decodePendingLogin(value: string | undefined): PendingLogin | null {
  if (!value) {
    return null;
  }
  try {
    const login = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8')) as Partial<PendingLogin>;
    if ([login.state, login.codeVerifier, login.nonce, login.returnTo].every((v) => typeof v === 'string' && v)) {
      return { ...(login as PendingLogin), returnTo: safeReturnTo(login.returnTo) };
    }
  } catch {
    // fall through
  }
  return null;
}

export function createAuthRouter(config: AuthConfig, sessions?: SessionStore): RouterType {
  const router = Router();

  if (config.mode !== 'oidc') {
    // The proxy (or nobody) handles login; send the browser back through it.
    router.get('/login', (req, res) => res.redirect(safeReturnTo(req.query.returnTo)));
    router.post('/logout', requireSameOrigin(config.mode === 'proxy' ? config.appUrl.origin : undefined), (_req, res) =>
      res.redirect(303, config.mode === 'proxy' && config.logoutUrl ? config.logoutUrl : '/'),
    );
    return router;
  }

  if (!sessions) {
    throw new Error('OIDC mode needs a session store');
  }
  return oidcRouter(router, config, sessions);
}

function oidcRouter(router: RouterType, config: OidcAuthConfig, sessions: SessionStore): RouterType {
  const redirectUri = new URL('/auth/callback', config.appUrl).toString();
  const secure = config.appUrl.protocol === 'https:';
  const names = cookieNames(config.appUrl);
  let discovered: Promise<oidc.Configuration> | null = null;

  // Discovered on first use, not at startup, so an IdP outage doesn't stop the app from starting.
  function provider(): Promise<oidc.Configuration> {
    discovered ??= oidc.discovery(config.issuer, config.clientId, config.clientSecret).catch((err) => {
      discovered = null;
      throw err;
    });
    return discovered;
  }

  router.get('/login', async (req: Request, res: Response) => {
    try {
      const configuration = await provider();
      // Kept in this browser's cookie, not server memory, so nobody can fill a shared list
      // of pending logins. The cookie is httpOnly and, on https, __Host- so siblings can't plant one.
      const login: PendingLogin = {
        state: oidc.randomState(),
        codeVerifier: oidc.randomPKCECodeVerifier(),
        nonce: oidc.randomNonce(),
        returnTo: safeReturnTo(req.query.returnTo),
      };
      res.cookie(names.login, encodePendingLogin(login), {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: PENDING_TTL_MS,
      });

      const url = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: redirectUri,
        scope: 'openid profile email groups',
        code_challenge: await oidc.calculatePKCECodeChallenge(login.codeVerifier),
        code_challenge_method: 'S256',
        state: login.state,
        nonce: login.nonce,
      });
      res.redirect(url.toString());
    } catch (err) {
      console.error('[Auth] Login failed:', err);
      res.status(502).send('Could not reach the identity provider.');
    }
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const login = decodePendingLogin(readCookie(req, names.login));
    res.clearCookie(names.login, { path: '/', secure, httpOnly: true, sameSite: 'lax' });
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!login || login.state !== state) {
      res.status(400).send('Login expired or was started in another browser. <a href="/auth/login">Start again</a>.');
      return;
    }

    try {
      const configuration = await provider();
      const currentUrl = new URL(req.originalUrl, config.appUrl);
      const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: login.codeVerifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) {
        throw new Error('no ID token claims');
      }
      // Providers differ on whether groups are in the ID token; the userinfo endpoint has them.
      const userInfo = await oidc.fetchUserInfo(configuration, tokens.access_token, claims.sub);
      const groups = stringList(userInfo.groups ?? claims.groups);
      const user = {
        subject: claims.sub,
        name: str(userInfo.name ?? userInfo.preferred_username ?? claims.name),
        email: str(userInfo.email ?? claims.email),
        groups,
      };

      if (!roleFor(groups, config)) {
        console.warn(`[Auth] ${user.subject} logged in but isn't in ${config.adminGroup}${config.readerGroup ? ` or ${config.readerGroup}` : ''}`);
        res.status(403).send('Your account is not in a group allowed to use this app.');
        return;
      }

      const token = sessions.create(user, config.sessionTtlMs);
      res.cookie(names.session, token, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: config.sessionTtlMs,
      });
      res.redirect(login.returnTo);
    } catch (err) {
      console.error('[Auth] Callback failed:', err);
      res.status(400).send('Login failed. <a href="/auth/login">Try again</a>.');
    }
  });

  router.post('/logout', requireSameOrigin(config.appUrl.origin), (req: Request, res: Response) => {
    const token = readCookie(req, names.session);
    if (token) {
      sessions.delete(token);
    }
    res.clearCookie(names.session, { path: '/', secure, httpOnly: true, sameSite: 'lax' });
    res.redirect(303, config.logoutUrl ?? '/');
  });

  return router;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
