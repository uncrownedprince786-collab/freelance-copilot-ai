'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

const NAV_ITEMS = [
  { href: '/', label: 'Leads', icon: '🏠' },
  { href: '/intelligence', label: 'Intelligence', icon: '📊' },
  { href: '/trading', label: 'AI Apply', icon: '⚡' },
] as const;

export default function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="lh-topbar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 0 12px',
      borderBottom: '1px solid #e5e7eb',
      marginBottom: 16,
      flexWrap: 'wrap',
    }}>
      {NAV_ITEMS.map(item => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <button
            key={item.href}
            onClick={() => router.push(item.href)}
            className={`lh-field ${active ? 'lh-active' : ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: active ? '1px solid #2563eb' : '1px solid #e5e7eb',
              background: active ? '#2563eb' : 'white',
              color: active ? 'white' : '#374151',
              fontWeight: active ? 600 : 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      <ThemeToggle />
    </nav>
  );
}
