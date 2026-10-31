import { useEffect, useState } from 'react';

interface CurrentUser {
  subject: string;
  name?: string;
  email?: string;
  role: 'admin' | 'reader';
  canLogout: boolean;
}

/** Any API call that comes back 401 means the session is gone: start a login, then come back here. */
export function installAuthRedirect(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (response.status === 401 && new URL(url, window.location.origin).pathname.startsWith('/api/')) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    return response;
  };
}

export function UserBox() {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (!user) {
    return null;
  }

  return (
    <div className="sidebar-user">
      <span className="sidebar-user-name" title={user.email ?? user.subject}>
        {user.name ?? user.subject}
        {user.role === 'reader' && <span className="sidebar-user-role"> (read-only)</span>}
      </span>
      {user.canLogout && (
        <form method="post" action="/auth/logout">
          <button type="submit" className="link-button">
            Log out
          </button>
        </form>
      )}
    </div>
  );
}
