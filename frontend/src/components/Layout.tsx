import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { UserBox } from '../auth.tsx';

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`layout ${drawerOpen ? 'drawer-open' : ''}`}>
      <button
        type="button"
        className="drawer-toggle"
        aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen((open) => !open)}
      >
        {drawerOpen ? '✕' : '☰'}
      </button>
      <aside className="sidebar">
        <Sidebar onNavigate={() => setDrawerOpen(false)} />
        <UserBox />
      </aside>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
