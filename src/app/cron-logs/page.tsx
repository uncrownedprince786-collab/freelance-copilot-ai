'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CronLogEntry {
  id: string;
  timestamp: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  jobsFetched: number;
  newJobsAdded: number;
  sourceSummary: string;
}

export default function CronLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<CronLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cron-logs');
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error('Failed to load cron logs', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.brandGroup} onClick={() => router.push('/')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Lead Hunter Logo" style={styles.logo} />
            <div>
              <h1 style={styles.brandTitle}>Lead Hunter</h1>
              <p style={styles.slogan}>Stop scrolling. Start winning</p>
            </div>
          </div>
          <button onClick={() => router.push('/')} style={styles.backBtn}>
            &larr; Back to Dashboard
          </button>
        </header>

        {/* Page Title */}
        <div style={styles.titleSection}>
          <h2 style={styles.pageTitle}>Today&apos;s Cron Execution Activity</h2>
          <p style={styles.pageSubtitle}>
            Monitor automated background runs from the last 24 hours. Shows execution timestamp, status, and new jobs discovered.
          </p>
        </div>

        {/* Loading / Content */}
        {loading ? (
          <div style={styles.loadingBox}>
            <div style={styles.spinner} />
            <p style={{ marginTop: 12, color: '#64748b', fontSize: 14 }}>Loading today&apos;s cron logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div style={styles.emptyBox}>
            <p style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>No background runs recorded today</p>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
              The 4-hour scheduled cron runner will automatically log its executions here.
            </p>
          </div>
        ) : (
          <div style={styles.logsList}>
            {logs.map(log => (
              <div key={log.id} style={styles.logCard}>
                <div style={styles.logCardHeader}>
                  <div style={styles.timeGroup}>
                    <span style={styles.logTime}>{formatTime(log.timestamp)}</span>
                    <span style={styles.logDate}>{formatDate(log.timestamp)}</span>
                  </div>
                  <span style={{
                    ...styles.statusBadge,
                    background: log.status === 'SUCCESS' ? '#dcfce7' : '#fee2e2',
                    color: log.status === 'SUCCESS' ? '#15803d' : '#b91c1c'
                  }}>
                    {log.status}
                  </span>
                </div>

                <div style={styles.logBody}>
                  <div style={styles.metricCell}>
                    <div style={styles.metricLabel}>New Jobs Added</div>
                    <div style={styles.metricValHighlight}>+{log.newJobsAdded}</div>
                  </div>
                  <div style={styles.metricCell}>
                    <div style={styles.metricLabel}>Total Scraped</div>
                    <div style={styles.metricVal}>{log.jobsFetched}</div>
                  </div>
                  <div style={styles.metricCell}>
                    <div style={styles.metricLabel}>Platform</div>
                    <div style={styles.metricValSm}>
                      {log.sourceSummary
                        ? log.sourceSummary
                            .replace(/apify/gi, 'Upwork')
                            .replace(/Apify/g, 'Upwork')
                        : 'Upwork'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)',
    color: '#111827',
    padding: '24px 16px',
    fontFamily: 'Inter,"Segoe UI",sans-serif'
  },
  shell: { maxWidth: 900, margin: '0 auto' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: '1px solid #e2e8f0'
  },
  brandGroup: { display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' },
  logo: { height: 42, width: 'auto', objectFit: 'contain' as const },
  brandTitle: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 },
  slogan: { fontSize: 12, color: '#16a34a', fontWeight: 600, margin: '2px 0 0' },
  backBtn: {
    background: '#fff',
    border: '1px solid #dbe2ea',
    borderRadius: 999,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#2563eb',
    cursor: 'pointer'
  },
  titleSection: { marginBottom: 20 },
  pageTitle: { fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' },
  pageSubtitle: { fontSize: 13, color: '#64748b', margin: 0 },
  loadingBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0' },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #dbeafe',
    borderTopColor: '#2563eb',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  emptyBox: {
    background: '#fff',
    borderRadius: 14,
    padding: 32,
    textAlign: 'center' as const,
    border: '1px solid #e2e8f0'
  },
  logsList: { display: 'flex', flexDirection: 'column', gap: 12 },
  logCard: {
    background: '#fff',
    borderRadius: 14,
    padding: 16,
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(15,23,42,0.04)'
  },
  logCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  timeGroup: { display: 'flex', alignItems: 'baseline', gap: 8 },
  logTime: { fontSize: 16, fontWeight: 800, color: '#0f172a' },
  logDate: { fontSize: 12, color: '#94a3b8' },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999 },
  logBody: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, background: '#f8fafc', borderRadius: 10, padding: 12 },
  metricCell: {},
  metricLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 },
  metricValHighlight: { fontSize: 18, fontWeight: 800, color: '#16a34a' },
  metricVal: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  metricValSm: { fontSize: 13, fontWeight: 600, color: '#475569' }
};
