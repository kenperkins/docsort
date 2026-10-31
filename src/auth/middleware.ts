import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthConfig, RoleGroups } from './config.js';
import { isTrustedAddress } from './ip.js';
import type { SessionStore, SessionUser } from './sessions.js';

export type Role = 'admin' | 'reader';

export interface AuthUser extends SessionUser {
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * __Host- cookies can only be set by this exact host over https, with Path=/, so a sibling app
 * on the same parent domain can't plant a session or login cookie. Plain names for http dev.
 */
export function cookieNames(appUrl: URL): { session: string; login: string } {
  const prefix = appUrl.protocol === 'https:' ? '__Host-' : '';
  return { session: `${prefix}docsort_session`, login: `${prefix}docsort_login` };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function roleFor(groups: string[], roles: RoleGroups): Role | null {
  if (groups.includes(roles.adminGroup)) {
    return 'admin';
  }
  if (roles.readerGroup && groups.includes(roles.readerGroup)) {
    return 'reader';
  }
  return null;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Who is making this request, before any role check; null if nobody we trust. */
export function identify(config: AuthConfig, req: Request, sessions?: SessionStore): SessionUser | null {
  switch (config.mode) {
    case 'none':
      return { subject: 'local', name: 'Local (no auth)', groups: [] };

    case 'proxy': {
      // Remote-* headers are only meaningful from the proxy; anyone else could set them.
      if (!isTrustedAddress(config.trustedProxies, req.socket.remoteAddress)) {
        return null;
      }
      const subject = headerValue(req, 'remote-user');
      if (!subject) {
        return null;
      }
      const groups = (headerValue(req, 'remote-groups') ?? '').split(',').map((g) => g.trim()).filter(Boolean);
      return { subject, name: headerValue(req, 'remote-name'), email: headerValue(req, 'remote-email'), groups };
    }

    case 'oidc': {
      const token = readCookie(req, cookieNames(config.appUrl).session);
      return token && sessions ? sessions.get(token) : null;
    }
  }
}

export function requireAuth(config: AuthConfig, sessions?: SessionStore): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const identity = identify(config, req, sessions);
    if (!identity) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const role = config.mode === 'none' ? 'admin' : roleFor(identity.groups, config);
    if (!role) {
      res.status(403).json({ error: 'Your account is not in a group allowed to use this app' });
      return;
    }
    if (role === 'reader' && !SAFE_METHODS.has(req.method)) {
      res.status(403).json({ error: 'Read-only access' });
      return;
    }

    req.user = { ...identity, role };
    next();
  };
}

/**
 * Rejects state-changing requests that a browser marks as coming from another site, including
 * sibling apps on the same parent domain (same-site, so SameSite=Lax cookies would be sent).
 */
export function requireSameOrigin(appOrigin: string | undefined): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    // Sec-Fetch-Site is set by the browser and can't be changed by page script, so it decides
    // when present. Origin alone is unreliable: under some referrer policies browsers send
    // "Origin: null" even for same-origin form posts and fetches.
    const fetchSite = headerValue(req, 'sec-fetch-site');
    const origin = headerValue(req, 'origin');
    const allowed =
      fetchSite !== undefined
        ? fetchSite === 'same-origin' || fetchSite === 'none'
        : origin === undefined || appOrigin === undefined || origin === appOrigin;
    if (!allowed) {
      res.status(403).json({ error: 'Cross-origin request refused' });
      return;
    }
    next();
  };
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}
