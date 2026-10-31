import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Headers for every response. The app holds tax and medical paperwork, so it never runs
 * inline or third-party script and can't be framed.
 */
export function securityHeaders(logoutUrl?: string): RequestHandler {
  // A form's redirect target counts against form-action, and Log out redirects to the provider.
  const formAction = ["'self'", ...(logoutUrl ? [new URL(logoutUrl).origin] : [])].join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
  ].join('; ');

  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // same-origin, not no-referrer: no-referrer also makes browsers send "Origin: null" on
    // same-origin writes. Nothing is sent to other sites either way.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  };
}

/**
 * Streams a stored PDF. The page-level CSP and frame headers are dropped for this response:
 * browsers' built-in PDF viewers render it in their own frame. nosniff stays.
 */
export function sendPdf(res: Response, filepath: string, filename: string, download = false): void {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Frame-Options');
  if (download) {
    res.attachment(filename);
  } else {
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }
  res.sendFile(filepath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File not found on disk' });
    }
  });
}
