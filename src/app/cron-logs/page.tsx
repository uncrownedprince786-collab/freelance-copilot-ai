'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { ThemeToggle } from '@/components/ThemeToggle';
import SiteNav from '@/components/SiteNav';
import { formatTime12 } from '@/lib/format';

interface CronLogEntry {
  id: string;
  timestamp: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  jobsFetched: number;
  newJobsAdded: number;
  sourceSummary: string;
}

// GitHub Actions fires every 20 minutes (.github/workflows/cron-sync.yml);
// the Vercel cron (vercel.json) additionally fires once daily at 08:00 UTC.
// The /api/sync endpoint enforces an adaptive cooldown, so this is the raw
// scheduler cadence, not the actual fetch cadence.
function nextScheduledRun(): number {
  const now = Date.now();
  const tick = 20 * 60 * 1000;
  return Math.ceil(now / tick) * tick;
}

export default function CronLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<CronLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalStoredJobs, setTotalStoredJobs] = useState(0);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState('');
  const [countdown, setCountdown] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAdmin()) { router.push('/'); return; }
    fetchLogs();
  }, [router]);

  // Countdown to the next scheduled trigger (every 20 minutes via GitHub Actions).
  // Whether a tick actually fetches depends on the adaptive sync cooldown.
  useEffect(() => {
    const tick = () => {
      const diff = nextScheduledRun() - Date.now();
      if (diff <= 0) { setCountdown('Due now'); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${m}m ${s.toString().padStart(2, '0')}s`);
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cron-logs');
      const data = await res.json();
      if (data.logs) setLogs(data.logs);
      if (data.totalStoredJobs) setTotalStoredJobs(data.totalStoredJobs);
    } catch (err) {
      console.error('Failed to load cron logs', err);
    } finally {
      setLoading(false);
    }
  };

  const runManualSync = async () => {
    setRunning(true);
    setRunMsg('Running sync…');
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (data.newJobs > 0) {
        setRunMsg(`Done — ${data.newJobs} new jobs added.`);
      } else {
        setRunMsg('Done — no new jobs found.');
      }
      await fetchLogs();
    } catch {
      setRunMsg('Sync failed. Try again.');
    } finally {
      setRunning(false);
      setTimeout(() => setRunMsg(''), 5000);
    }
  };

  const formatTime = (isoStr: string) => formatTime12(isoStr);
  const formatDate = (isoStr: string) => new Date(isoStr).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={st.page} className="lh-page">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={st.shell}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <SiteNav />
          <button onClick={runManualSync} disabled={running} style={st.runBtn}>
            {running ? 'Running…' : 'Run Sync Now'}
          </button>
        </div>

        {/* Status bar */}
        <div style={st.statusBar}>
          <div style={st.statusItem} className="lh-surface">
            <div className="lh-muted" style={st.statusLabel}>Jobs Stored</div>
            <div className="lh-h" style={st.statusVal}>{totalStoredJobs || '—'}</div>
          </div>
          <div style={st.statusItem} className="lh-surface">
            <div className="lh-muted" style={st.statusLabel}>Last Run</div>
            <div className="lh-h" style={st.statusVal}>{logs.length > 0 ? formatTime(logs[0].timestamp) : '—'}</div>
          </div>
          <div style={st.statusItem} className="lh-surface">
            <div className="lh-muted" style={st.statusLabel}>Next Scheduled Run</div>
            <div style={{ ...st.statusVal, color: '#2563eb', fontFamily: 'monospace' }}>{countdown || '—'}</div>
          </div>
          <div style={st.statusItem} className="lh-surface">
            <div className="lh-muted" style={st.statusLabel}>Schedule</div>
            <div className="lh-h" style={st.statusVal}>Adaptive (peak ~20 min)</div>
          </div>
        </div>

        {/* Manual run message */}
        {runMsg && (
          <div style={st.runMsgBox}>{runMsg}</div>
        )}

        {/* Cache explanation */}
{totalStoredJobs > 0 && (
          <div style={st.infoBox}>
            <strong>{totalStoredJobs} jobs stored</strong> in dashboard. &nbsp;&ldquo;Total Scraped&rdquo; = raw count from that run. Dashboard total = deduplicated accumulation across all runs.
          </div>
        )}

        {/* Page Title */}
        <div style={{ margin: '20px 0 12px' }}>
          <h2 style={st.pageTitle}>Cron Execution Logs</h2>
          <p className="lh-body" style={st.pageSubtitle}>Last 24 hours of automated background runs — timestamp, status, and jobs discovered.</p>
        </div>

        {/* Content */}
        {loading ? (
          <div style={st.center}><div style={st.spinner} /><p className="lh-muted" style={{ color: '#6b7280', marginTop: 12, fontSize: 14 }}>Loading…</p></div>
        ) : logs.length === 0 ? (
          <div style={st.emptyBox} className="lh-surface">
            <p className="lh-h" style={{ fontWeight: 700, fontSize: 15, color: '#111827', margin: '0 0 6px' }}>No runs recorded in the last 24 hours</p>
            <p className="lh-muted" style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>
              Use &quot;Run Sync Now&quot; above to trigger a manual sync, or wait for the scheduled cron.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {logs.map(log => (
              <div key={log.id} style={st.logCard} className="lh-surface">
                <div style={st.logCardHeader}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="lh-h" style={st.logTime}>{formatTime(log.timestamp)}</span>
                    <span className="lh-muted" style={st.logDate}>{formatDate(log.timestamp)}</span>
                  </div>
                  <span style={{ ...st.statusBadge, background: log.status === 'SUCCESS' ? '#f0fdf4' : '#fef2f2', color: log.status === 'SUCCESS' ? '#15803d' : '#b91c1c', border: `1px solid ${log.status === 'SUCCESS' ? '#bbf7d0' : '#fecaca'}` }}>
                    {log.status}
                  </span>
                </div>
                <div style={st.logBody} className="lh-surface">
                  <div style={st.metricCell}>
                    <div className="lh-muted" style={st.metricLabel}>New Jobs Added</div>
                    <div style={{ ...st.metricVal, color: '#16a34a', fontSize: 20, fontWeight: 800 }}>+{log.newJobsAdded}</div>
                  </div>
                  <div style={st.metricCell}>
                    <div className="lh-muted" style={st.metricLabel}>Total Scraped</div>
                    <div className="lh-h" style={st.metricVal}>{log.jobsFetched}</div>
                  </div>
                  <div style={st.metricCell}>
                    <div className="lh-muted" style={st.metricLabel}>Platform</div>
                    <div className="lh-h" style={{ ...st.metricVal, fontSize: 13, fontWeight: 600 }}>
                      {log.sourceSummary ? log.sourceSummary.replace(/apify/gi, 'Upwork') : 'Upwork'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <footer className="lh-muted" style={st.footer}>
          Lead Hunter &middot; Admin Panel &middot; Developed by Abdul Raheem &middot; geeksxperts@gmail.com
        </footer>
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f9fc',     padding: '24px 16px', color: '#111827' },
  shell: { maxWidth: 900, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brandGroup: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  brandTitle: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#16a34a', fontWeight: 600 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  runBtn: { background: '#16a34a', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' },
  statusBar: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: 10, marginBottom: 16 },
  statusItem: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  statusLabel: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 4 },
  statusVal: { fontSize: 15, fontWeight: 700, color: '#111827' },
  runMsgBox: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15803d', fontWeight: 600, marginBottom: 12 },
  infoBox: { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1d4ed8', marginBottom: 4 },
  pageTitle: { fontSize: 18, fontWeight: 800, color: '#111827', margin: '0 0 4px' },
  pageSubtitle: { fontSize: 13, color: '#6b7280', margin: 0 },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40 },
  spinner: { width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  emptyBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center' as const, border: '1px solid #e5e7eb' },
  logCard: { background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' },
  logCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #f3f4f6' },
  logTime: { fontSize: 16, fontWeight: 800, color: '#111827' },
  logDate: { fontSize: 12, color: '#9ca3af' },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  logBody: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(130px,100%),1fr))', gap: 0, background: '#f9fafb' },
  metricCell: { padding: '14px 18px', borderRight: '1px solid #f3f4f6' },
  metricLabel: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 4 },
  metricVal: { fontSize: 16, fontWeight: 700, color: '#111827' },
  footer: { textAlign: 'center' as const, marginTop: 40, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
