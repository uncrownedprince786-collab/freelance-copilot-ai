'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { ThemeToggle } from '@/components/ThemeToggle';
import { IconShield, IconUsers, IconLock, IconUser, IconRefresh, IconList } from '@/components/icons';
import { formatTime12, formatDateTime12 } from '@/lib/format';

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

const EVENT_LABELS: Record<string, string> = {
  session_start: 'Session started',
  session_end: 'Session ended',
  heartbeat: 'Active heartbeat',
  view_job: 'Viewed job',
  sync: 'Ran sync',
  login: 'Logged in',
  logout: 'Logged out',
};

function eventLabel(event: string): string {
  return EVENT_LABELS[event] || (event.charAt(0).toUpperCase() + event.slice(1).replace(/_/g, ' '));
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

// Online/Offline is derived from real activity: a live session (recent
// heartbeat within the 15-minute session window) is Online, older activity is
// Offline. Label + color reflect observed telemetry, never guesses.
function statusInfo(status?: string): { label: string; bg: string; color: string } {
  switch (status) {
    case 'Active': return { label: 'Online', bg: '#dcfce7', color: '#15803d' };
    case 'Idle': return { label: 'Idle', bg: '#fef9c3', color: '#92400e' };
    case 'Offline': return { label: 'Offline', bg: '#fee2e2', color: '#b91c1c' };
    default: return { label: '—', bg: '#f1f5f9', color: '#475569' };
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
    // Auto-refresh so admin sees live Online/Offline status.
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
  const onlineCount = sessions.filter(s => s.status === 'Active').length;
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle />
            <button onClick={() => router.push('/')} style={st.backBtn} className="lh-field">← Dashboard</button>
          </div>
        </header>

        {/* Page Title */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={st.pageTitle}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <IconShield size={20} color="#1e3a8a" />
              Admin — User Sessions
            </span>
          </h2>
          <p className="lh-body" style={st.pageSubtitle}>Track every visitor, guest &amp; admin — what they did, how long they stayed.</p>
        </div>

        {/* Stats */}
        <div style={st.statsRow}>
          {[
            { label: 'Total Sessions', val: sessions.length, color: '#2563eb' },
            { label: 'Admin Sessions', val: adminCount, color: '#16a34a' },
            { label: 'Guest Sessions', val: guestCount, color: '#f59e0b' },
            { label: 'Online Now', val: onlineCount, color: '#8b5cf6' },
            { label: 'Avg Duration', val: formatDuration(avgDuration), color: '#0ea5e9' },
          ].map(s => (
            <div key={s.label} style={st.statCard} className="lh-surface">
              <div style={{ ...st.statVal, color: s.color }}>{s.val}</div>
              <div className="lh-muted" style={st.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {([
            { key: 'all' as const, label: 'All', Icon: IconUsers },
            { key: 'admin' as const, label: 'Admin', Icon: IconLock },
            { key: 'guest' as const, label: 'Guests', Icon: IconUser },
          ]).map(f => (
            <button key={f.key} onClick={() => setRoleFilter(f.key)} className={roleFilter === f.key ? 'lh-field lh-active' : 'lh-field'} style={{
              ...st.filterBtn,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: roleFilter === f.key ? '#2563eb' : '#fff',
              color: roleFilter === f.key ? '#fff' : '#334155',
            }}>
              <f.Icon size={14} color={roleFilter === f.key ? '#fff' : '#334155'} />
              {f.label}
            </button>
          ))}
          <button onClick={fetchSessions} style={{ ...st.filterBtn, marginLeft: 'auto', color: '#2563eb', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconRefresh size={14} color="#2563eb" />
            Refresh
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
            {filtered.map(s => {
              const status = statusInfo(s.status);
              return (
                <div key={s.guestId} style={st.card} className="lh-surface">
                  <div style={st.cardHeader} onClick={() => setExpandedId(expandedId === s.guestId ? null : s.guestId)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {s.role === 'admin' ? <IconLock size={20} color="#2563eb" /> : <IconUser size={20} color="#f59e0b" />}
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
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Started</div>
                        <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{formatDateTime12(s.startTime)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Last Active</div>
                        <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{timeAgo(s.lastSeen)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Duration</div>
                        <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{formatDuration(s.durationMs)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="lh-muted" style={{ fontSize: 12, color: '#64748b' }}>Status</div>
                        <div style={{ ...st.statusPill, background: status.bg, color: status.color }}>{status.label}</div>
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
                      <div className="lh-muted" style={st.eventHeader}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <IconList size={14} color="#64748b" />
                          Activity Log
                        </span>
                      </div>
                      {s.events.length === 0 ? (
                        <p className="lh-muted" style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0' }}>
                          No activity recorded for this session.
                        </p>
                      ) : (
                        <table style={st.eventTable}>
                          <thead>
                            <tr>
                              <th style={st.th}>Time</th>
                              <th style={st.th}>Event</th>
                              <th style={st.th}>Detail</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.events.map((ev, i) => (
                              <tr key={i}>
                                <td className="lh-muted" style={st.tdTime}>{formatTime12(ev.timestamp)}</td>
                                <td style={st.td}>
                                  <span style={{ ...st.eventTag, background: ev.event === 'session_start' ? '#dcfce7' : ev.event === 'session_end' ? '#fee2e2' : ev.event === 'heartbeat' ? '#e0e7ff' : '#dbeafe', color: ev.event === 'session_start' ? '#15803d' : ev.event === 'session_end' ? '#b91c1c' : '#1e40af' }}>
                                    {eventLabel(ev.event)}
                                  </span>
                                </td>
                                <td className="lh-body" style={st.tdDetail}>{ev.detail || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
  page: { minHeight: '100vh', background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)', padding: '24px 16px' },
  shell: { maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 8 },
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
  eventTable: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' },
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tdTime: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' },
  tdDetail: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#475569', flex: 1 },
  eventTag: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' },
  statusPill: { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999 },
};
