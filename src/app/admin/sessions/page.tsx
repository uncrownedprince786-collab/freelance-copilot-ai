'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';

interface SessionEvent {
  event: string;
  detail?: string;
  timestamp: string;
  role: string;
}

interface Session {
  guestId: string;
  role: 'admin' | 'guest';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  events: SessionEvent[];
  lastSeen: string;
  status?: string;
  location?: string;
}

function formatDuration(ms?: number) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

function statusBg(status?: string) {
  switch (status) {
    case 'Active': return '#dcfce7';
    case 'Idle': return '#fef9c3';
    case 'Offline': return '#fee2e2';
    default: return '#f1f5f9';
  }
}

export default function AdminSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'guest'>('all');

  useEffect(() => {
    if (!isAdmin()) {
      router.push('/');
      return;
    }
    fetchSessions();
    // Auto-refresh so admin sees live Active/Idle/Offline status.
    const interval = setInterval(fetchSessions, 30_000);
    return () => clearInterval(interval);
  }, [router]);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sessions/track');
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const filtered = sessions.filter(s => roleFilter === 'all' || s.role === roleFilter);
  const adminCount = sessions.filter(s => s.role === 'admin').length;
  const guestCount = sessions.filter(s => s.role === 'guest').length;
  const avgDuration = sessions.filter(s => s.durationMs).reduce((a, s) => a + (s.durationMs ?? 0), 0) / (sessions.filter(s => s.durationMs).length || 1);

  return (
    <div style={st.page} className="lh-page">
      <div style={st.shell}>
        {/* Header */}
        <header style={st.header} className="lh-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => router.push('/')}>
            <div>
              <h1 style={st.brand}>Lead Hunter</h1>
              <p style={st.slogan}>Stop scrolling. Start winning</p>
            </div>
          </div>
          <button onClick={() => router.push('/')} style={st.backBtn} className="lh-field">← Dashboard</button>
        </header>

        {/* Page Title */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={st.pageTitle}>🛡️ Admin — User Sessions</h2>
          <p className="lh-body" style={st.pageSubtitle}>Track every visitor, guest & admin — what they did, how long they stayed.</p>
        </div>

        {/* Stats */}
        <div style={st.statsRow}>
          {[
            { label: 'Total Sessions', val: sessions.length, color: '#2563eb' },
            { label: 'Admin Sessions', val: adminCount, color: '#16a34a' },
            { label: 'Guest Sessions', val: guestCount, color: '#f59e0b' },
            { label: 'Avg Duration', val: formatDuration(avgDuration), color: '#8b5cf6' },
          ].map(s => (
            <div key={s.label} style={st.statCard} className="lh-surface">
              <div style={{ ...st.statVal, color: s.color }}>{s.val}</div>
              <div className="lh-muted" style={st.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {(['all', 'admin', 'guest'] as const).map(f => (
            <button key={f} onClick={() => setRoleFilter(f)} className={roleFilter === f ? 'lh-field lh-active' : 'lh-field'} style={{
              ...st.filterBtn,
              background: roleFilter === f ? '#2563eb' : '#fff',
              color: roleFilter === f ? '#fff' : '#334155',
            }}>
              {f === 'all' ? '👥 All' : f === 'admin' ? '🔐 Admin' : '👤 Guests'}
            </button>
          ))}
          <button onClick={fetchSessions} style={{ ...st.filterBtn, marginLeft: 'auto', color: '#2563eb' }}>
            🔄 Refresh
          </button>
        </div>

        {/* Sessions List */}
        {loading ? (
          <div style={st.center}><div style={st.spinner} /><p className="lh-muted" style={{ color: '#64748b', marginTop: 12 }}>Loading sessions…</p></div>
        ) : filtered.length === 0 ? (
          <div style={st.emptyBox} className="lh-surface">
            <p className="lh-h" style={{ fontWeight: 700, fontSize: 16 }}>No sessions recorded yet</p>
            <p className="lh-muted" style={{ color: '#64748b', fontSize: 13 }}>Sessions will appear here when users visit the site.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(s => (
              <div key={s.guestId} style={st.card} className="lh-surface">
                <div style={st.cardHeader} onClick={() => setExpandedId(expandedId === s.guestId ? null : s.guestId)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{s.role === 'admin' ? '🔐' : '👤'}</span>
                    <div>
                      <div className="lh-h" style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                        {s.role === 'admin' ? 'Admin' : 'Guest'}
                        <span style={{ ...st.roleBadge, background: s.role === 'admin' ? '#dcfce7' : '#fef9c3', color: s.role === 'admin' ? '#15803d' : '#92400e' }}>
                          {s.role.toUpperCase()}
                        </span>
                      </div>
                      <div className="lh-muted" style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        ID: {s.guestId.slice(0, 20)}…
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Started</div>
                      <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{timeAgo(s.startTime)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Duration</div>
                      <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{formatDuration(s.durationMs)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Status</div>
                      <div style={{ ...st.statusPill, background: statusBg(s.status) }}>{s.status || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Location</div>
                      <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{s.location || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Actions</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#2563eb' }}>{s.events.length}</div>
                    </div>
                    <span className="lh-muted" style={{ fontSize: 18, color: '#94a3b8' }}>{expandedId === s.guestId ? '▲' : '▼'}</span>
                  </div>
                </div>

                {expandedId === s.guestId && (
                  <div style={st.eventLog} className="lh-surface">
                    <div className="lh-muted" style={st.eventHeader}>📋 Activity Log</div>
                    {s.events.map((ev, i) => (
                      <div key={i} style={st.eventRow}>
                        <span className="lh-muted" style={st.eventTime}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                        <span style={{ ...st.eventTag, background: ev.event === 'session_start' ? '#dcfce7' : ev.event === 'session_end' ? '#fee2e2' : '#dbeafe', color: ev.event === 'session_start' ? '#15803d' : ev.event === 'session_end' ? '#b91c1c' : '#1e40af' }}>
                          {ev.event}
                        </span>
                        {ev.detail && <span className="lh-body" style={st.eventDetail}>{ev.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="lh-muted" style={{ textAlign: 'center', marginTop: 40, padding: '16px 0', borderTop: '1px solid #e2e8f0', color: '#94a3b8', fontSize: 12 }}>
          Developed by Abdul Raheem · geeksxperts@gmail.com · Lead Hunter Admin Panel
        </footer>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)', padding: '24px 16px', fontFamily: 'Inter,"Segoe UI",sans-serif' },
  shell: { maxWidth: 960, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' },
  brand: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 },
  slogan: { fontSize: 12, color: '#16a34a', fontWeight: 600, margin: '2px 0 0' },
  backBtn: { background: '#fff', border: '1px solid #dbe2ea', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#2563eb', cursor: 'pointer' },
  pageTitle: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' },
  pageSubtitle: { fontSize: 13, color: '#64748b', margin: 0 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: 12, marginBottom: 24 },
  statCard: { background: '#fff', borderRadius: 12, padding: '16px', border: '1px solid #e2e8f0', textAlign: 'center' },
  statVal: { fontSize: 26, fontWeight: 800 },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  filterBtn: { padding: '8px 16px', borderRadius: 999, border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40 },
  spinner: { width: 32, height: 32, border: '3px solid #dbeafe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  emptyBox: { background: '#fff', borderRadius: 14, padding: 40, textAlign: 'center', border: '1px solid #e2e8f0' },
  card: { background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', cursor: 'pointer', flexWrap: 'wrap', gap: 8 },
  roleBadge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, marginLeft: 8 },
  eventLog: { borderTop: '1px solid #f1f5f9', padding: '12px 20px', background: '#f8fafc' },
  eventHeader: { fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' },
  eventRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f1f5f9' },
  eventTime: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', minWidth: 80 },
  eventTag: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999 },
  eventDetail: { fontSize: 12, color: '#475569', flex: 1 },
  statusPill: { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color: '#0f172a' },
};
