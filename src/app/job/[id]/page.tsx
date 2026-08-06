'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';

interface Job {
  id: string;
  title: string;
  description: string;
  url: string;
  platform: string;
  budget: string;
  score: number;
  viewed: boolean;
  applied: boolean;
  postedAt: string;
  company?: string;
  location?: string;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  clientReviews?: string;
  connections?: number;
  isNew?: boolean;
}

interface Analysis {
  summary: string;
  score: number;
  risk: string;
  reasons: string[];
  bidAmount: string;
  questions: string[];
  proposal: string;
  originalBudget?: string;
  originalTimeline?: string;
  clientDetails?: string;
  technicalBlockers?: string[];
  blockerSolutions?: string[];
  suggestedEta?: string;
}

const PLATFORM_COLORS: Record<string, string> = {
  Upwork: '#14a800',
  Freelancer: '#29b2fe',
  RemoteOK: '#ff6b35',
  'Remote OK': '#ff6b35',
  WeWorkRemotely: '#3b82f6',
};

function getScoreColor(score: number) {
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${days}d ago`;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [proposalDraft, setProposalDraft] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      setShowAuthModal(true);
    }
    const stored = sessionStorage.getItem('selectedJob');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Job;
        if (parsed?.title) {
          setJob(parsed);
          setLoading(false);
          sessionStorage.removeItem('selectedJob');
          void fetchAnalysis(parsed);
          return;
        }
      } catch {/* continue to API fallback */}
    }
    void loadJobFromApi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id]);

  const loadJobFromApi = async () => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) throw new Error('Failed to load jobs');
      const jobs: Job[] = await res.json();
      const found = jobs.find(j => j.id === params.id);
      if (found) {
        setJob(found);
        void fetchAnalysis(found);
      } else {
        setError('Job not found.');
      }
    } catch {
      setError('Could not load job. Please go back and try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalysis = async (jobData: Job) => {
    setAnalyzing(true);
    setError('');
    try {
      // Validate inputs before sending
      if (!jobData.title || typeof jobData.title !== 'string') return;

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobData.title.slice(0, 300),
          description: jobData.description?.slice(0, 3000) ?? '',
          platform: jobData.platform ?? 'Unknown',
          budget: jobData.budget ?? 'Negotiable',
          clientName: jobData.clientName ?? jobData.company ?? '',
        }),
      });

      if (!res.ok) throw new Error('Analysis failed');
      const data: Analysis = await res.json();
      setAnalysis(data);
      setBidAmount(data.bidAmount ?? '');
      
      const client = jobData.clientName && jobData.clientName !== 'Upwork Client' && jobData.clientName !== 'Freelancer Client' ? jobData.clientName : 'there';
      let finalProposal = data.proposal ?? '';
      if (!finalProposal.toLowerCase().startsWith('hi ') && !finalProposal.toLowerCase().startsWith('dear ')) {
        finalProposal = `Hi ${client},\n\n${finalProposal}`;
      }
      setProposalDraft(finalProposal);
    } catch {
      setError('Analysis unavailable. You can still view the job and apply manually.');
    } finally {
      setAnalyzing(false);
    }
  };

  const openListing = async () => {
    if (!job) return;
    try {
      await fetch('/api/jobs/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      setJob(prev => prev ? { ...prev, viewed: true } : prev);
    } catch {/* non-critical */}
    window.open(job.url, '_blank', 'noopener,noreferrer');
  };

  const markApplied = async () => {
    if (!job) return;
    const nextState = !job.applied;
    try {
      await fetch('/api/jobs/applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, applied: nextState }),
      });
      setJob(prev => prev ? { ...prev, applied: nextState } : prev);
    } catch {/* non-critical */}
  };

  const copyProposal = async () => {
    try {
      await navigator.clipboard.writeText(proposalDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  /* ── LOADING STATE ── */
  if (loading) {
    return (
      <div style={s.page}>
        <div style={s.loadingCenter}>
          <div style={s.spinner} />
          <p style={{ color: '#64748b', marginTop: 12, fontSize: 14 }}>Loading job details…</p>
        </div>
      </div>
    );
  }

  /* ── ERROR / NOT FOUND ── */
  if (error && !job) {
    return (
      <div style={s.page}>
        <div style={s.errorBox}>
          <p style={{ color: '#dc2626', fontWeight: 600, marginBottom: 12 }}>{error}</p>
          <button onClick={() => router.push('/')} style={s.btnSecondary}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!job) return null;

  const rawName = job.clientName || job.company || '';
  const clientLabel = rawName && !rawName.toLowerCase().includes('client') ? rawName : null;
  const locationLabel = job.country || job.location || 'Remote';
  const connectionsLabel = (job.connections ?? 0) > 0 ? `${job.connections} connects` : null;

  /* ── RENDER ── */
  return (
    <div style={s.page}>
      <AdminLoginModal
        isOpen={showAuthModal}
        onClose={() => router.push('/')}
        onSuccess={() => setShowAuthModal(false)}
      />
      {/* ── TOPBAR ── */}
      <div style={s.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/')} style={s.backBtn}>
            &larr; Dashboard
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Lead Hunter Logo" style={{ height: 32, width: 'auto', cursor: 'pointer' }} onClick={() => router.push('/')} />
          <span style={{ fontWeight: 800, fontSize: 16, color: '#0f172a', cursor: 'pointer' }} onClick={() => router.push('/')}>Lead Hunter</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...s.badge, background: PLATFORM_COLORS[job.platform] ?? '#6c5ce7' }}>
            {job.platform}
          </span>
          {job.isNew && <span style={{ ...s.badge, background: '#22c55e' }}>New</span>}
          {job.applied && <span style={{ ...s.badge, background: '#3b82f6' }}>Applied</span>}
          {job.viewed && !job.applied && <span style={{ ...s.badge, background: '#94a3b8' }}>Viewed</span>}
          <span style={s.timeAgo}>{timeAgo(job.postedAt)}</span>
        </div>
      </div>

      {/* ── MAIN LAYOUT: left | right ── */}
      <div style={s.layout}>

        {/* ──── LEFT: JOB INFO ──── */}
        <section style={s.leftPanel}>
          <h1 style={s.title}>{job.title}</h1>

          {/* Meta strip */}
          <div style={s.metaStrip}>
            {clientLabel && <span style={s.metaChip}>Client: {clientLabel}</span>}
            <span style={s.metaChip}>Location: {locationLabel}</span>
            {job.budget && job.budget !== 'Negotiable' && (
              <span style={{ ...s.metaChip, background: '#f0fdf4', color: '#16a34a' }}>Budget: {job.budget}</span>
            )}
            {connectionsLabel && (
              <span style={{ ...s.metaChip, background: '#eff6ff', color: '#2563eb', fontWeight: 600 }}>
                {connectionsLabel} required
              </span>
            )}
            {job.clientSpend && <span style={s.metaChip}>Total spent: {job.clientSpend}</span>}
          </div>

          {/* Score bar */}
          <div style={s.scoreRow}>
            <span style={{ ...s.scorePct, color: getScoreColor(job.score) }}>{job.score}%</span>
            <div style={s.barTrack}>
              <div style={{ ...s.barFill, width: `${job.score}%`, background: getScoreColor(job.score) }} />
            </div>
            <span style={s.scoreText}>
              {job.score >= 70 ? 'Strong fit' : job.score >= 50 ? 'Promising' : 'Low match'}
            </span>
          </div>

          {/* Description */}
          <div style={s.descWrap}>
            <h3 style={s.sectionLabel}>Project Description</h3>
            <div style={s.descBody}>{job.description || 'No description provided.'}</div>
          </div>

          {/* Actions */}
          <div style={s.actions}>
            <button onClick={openListing} style={s.btnPrimary}>Open on {job.platform}</button>
            {!job.applied && (
              <button onClick={markApplied} style={s.btnSecondary}>Mark as Applied</button>
            )}
          </div>
        </section>

        {/* ──── RIGHT: AI ANALYSIS ──── */}
        <aside style={s.rightPanel}>

          {/* Analyzing loader */}
          {analyzing && (
            <div style={s.card}>
              <p style={s.sectionLabel}>Generating proposal…</p>
              <div style={s.analyzeLoader}>
                <div style={s.spinner} />
                <p style={s.muted}>Reading the job, extracting requirements, writing a tailored proposal.</p>
              </div>
            </div>
          )}

          {/* Non-critical error banner */}
          {error && !analyzing && (
            <div style={s.warnBox}>{error}</div>
          )}

          {/* Analysis loaded */}
          {!analyzing && analysis && (
            <>
              {/* Verdict row */}
              <div style={s.card}>
                <div style={s.verdictGrid}>
                  <div style={s.verdictCell}>
                    <div style={s.vLabel}>AI Score</div>
                    <div style={{ ...s.vValue, color: getScoreColor(analysis.score) }}>{analysis.score}/100</div>
                  </div>
                  <div style={s.verdictCell}>
                    <div style={s.vLabel}>Risk</div>
                    <div style={{
                      ...s.vValue,
                      color: analysis.risk === 'Low' ? '#16a34a' : analysis.risk === 'High' ? '#dc2626' : '#d97706',
                    }}>{analysis.risk}</div>
                  </div>
                  <div style={s.verdictCell}>
                    <div style={s.vLabel}>ETA</div>
                    <div style={s.vValue}>{analysis.suggestedEta ?? 'Flexible'}</div>
                  </div>
                </div>
              </div>

              {/* Summary */}
              {analysis.summary && (
                <div style={s.card}>
                  <h4 style={s.sectionLabel}>Opportunity Summary</h4>
                  <p style={s.muted}>{analysis.summary}</p>
                </div>
              )}

              {/* Technical blockers */}
              {(analysis.technicalBlockers?.length ?? 0) > 0 && (
                <div style={s.card}>
                  <h4 style={s.sectionLabel}>Technical Considerations</h4>
                  <ul style={s.list}>
                    {analysis.technicalBlockers!.map((b, i) => <li key={i} style={s.listItem}>{b}</li>)}
                  </ul>
                  {(analysis.blockerSolutions?.length ?? 0) > 0 && (
                    <>
                      <h4 style={{ ...s.sectionLabel, marginTop: 10 }}>Suggested Approach</h4>
                      <ul style={s.list}>
                        {analysis.blockerSolutions!.map((b, i) => <li key={i} style={s.listItem}>{b}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {/* Questions */}
              {(analysis.questions?.length ?? 0) > 0 && (
                <div style={s.card}>
                  <h4 style={s.sectionLabel}>Questions to Ask</h4>
                  <ol style={{ ...s.list, paddingLeft: 18 }}>
                    {analysis.questions.map((q, i) => <li key={i} style={s.listItem}>{q}</li>)}
                  </ol>
                </div>
              )}

              {/* Bid + Proposal */}
              <div style={s.card}>
                <div style={s.proposalHeader}>
                  <h4 style={s.sectionLabel}>Proposal</h4>
                </div>

                {/* Budget / bid row */}
                <div style={s.bidRow}>
                  <div style={s.bidCell}>
                    <div style={s.vLabel}>Listed Budget</div>
                    <div style={s.vValue}>{analysis.originalBudget || job.budget || 'Negotiable'}</div>
                  </div>
                  <div style={s.bidCell}>
                    <div style={s.vLabel}>Suggested Bid</div>
                    <input
                      value={bidAmount}
                      onChange={e => setBidAmount(e.target.value)}
                      style={s.bidInput}
                      aria-label="Bid amount"
                    />
                  </div>
                </div>

                <textarea
                  value={proposalDraft}
                  onChange={e => setProposalDraft(e.target.value)}
                  style={s.proposalTA}
                  aria-label="Proposal text"
                />
                <button onClick={() => void copyProposal()} style={s.btnPrimary}>
                  {copied ? 'Copied!' : 'Copy Proposal'}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── STYLES ─────────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#f0f4ff',
    fontFamily: 'Inter,"Segoe UI",sans-serif',
    color: '#111827',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: 8,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: '#2563eb',
    fontWeight: 600,
    padding: '4px 0',
  },
  badge: {
    color: '#fff',
    borderRadius: 999,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 700,
  },
  timeAgo: { fontSize: 12, color: '#94a3b8' },

  layout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 0,
    flex: 1,
    overflow: 'hidden',
  },

  /* LEFT */
  leftPanel: {
    padding: '16px 20px',
    overflowY: 'auto',
    borderRight: '1px solid #e2e8f0',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: 800, color: '#0f172a', lineHeight: 1.3, margin: 0 },
  metaStrip: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  metaChip: {
    background: '#f1f5f9',
    color: '#334155',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 500,
  },
  scoreRow: { display: 'flex', alignItems: 'center', gap: 10 },
  scorePct: { fontSize: 22, fontWeight: 800, minWidth: 48 },
  barTrack: { flex: 1, height: 6, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999 },
  scoreText: { fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' as const },

  descWrap: { flex: 1, minHeight: 0 },
  sectionLabel: { fontSize: 13, fontWeight: 700, color: '#374151', margin: '0 0 6px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  descBody: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap' as const,
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 360px)',
    paddingRight: 4,
  },

  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, paddingTop: 4 },
  btnPrimary: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '9px 18px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  btnSecondary: {
    background: '#fff',
    color: '#334155',
    border: '1px solid #dbe2ea',
    borderRadius: 999,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnGhost: {
    background: 'none',
    border: '1px solid #dbe2ea',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 12,
    color: '#64748b',
    cursor: 'pointer',
  },

  /* RIGHT */
  rightPanel: {
    padding: '16px',
    overflowY: 'auto',
    background: '#f8fafc',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: '14px 16px',
  },

  verdictGrid: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, textAlign: 'center' as const },
  verdictCell: {},
  vLabel: { fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 },
  vValue: { fontSize: 16, fontWeight: 800, color: '#0f172a' },

  muted: { fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: 0 },
  list: { paddingLeft: 16, margin: 0 },
  listItem: { fontSize: 13, color: '#475569', lineHeight: 1.6, marginBottom: 6 },

  proposalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  bidRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 },
  bidCell: { background: '#f8fafc', borderRadius: 10, padding: '8px 12px' },
  bidInput: {
    width: '100%',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
    background: 'transparent',
    boxSizing: 'border-box' as const,
  },
  proposalTA: {
    width: '100%',
    height: 'calc(100vh - 620px)',
    minHeight: 160,
    maxHeight: 400,
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 13,
    lineHeight: 1.65,
    color: '#334155',
    background: '#f8fafc',
    resize: 'vertical' as const,
    marginBottom: 10,
    boxSizing: 'border-box' as const,
    display: 'block',
  },

  loadingCenter: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  spinner: {
    width: 32, height: 32,
    border: '3px solid #dbeafe',
    borderTopColor: '#2563eb',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  analyzeLoader: { textAlign: 'center' as const, padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  errorBox: { background: '#fff', border: '1px solid #fecaca', borderRadius: 14, padding: 24, textAlign: 'center' as const },
  warnBox: {
    background: '#fefce8',
    border: '1px solid #fde68a',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    color: '#92400e',
  },
};