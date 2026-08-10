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
  budgetType?: string;
  score: number;
  viewed: boolean;
  applied: boolean;
  postedAt: string;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  clientRating?: string;
  clientReviews?: string;
  paymentVerified?: boolean;
  jobsPosted?: number | null;
  memberSince?: string;
  connections?: number;
  skills?: string[];
  experienceLevel?: string;
  duration?: string;
  proposalCount?: number | null;
  interviewingCount?: number;
  hiresCount?: number;
  isNew?: boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: Record<string, any>;
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
  technicalBlockers?: string[];
  blockerSolutions?: string[];
  suggestedEta?: string;
  cached?: boolean;
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
  if (mins < 60) return `${mins} minutes ago`;
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function cleanExpLevel(raw?: string) {
  if (!raw) return '';
  return raw.replace(/level/gi, '').replace(/([A-Z])/g, ' $1').trim();
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
      } catch {/* fallback */}
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
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobData.title.slice(0, 300),
          description: jobData.description?.slice(0, 3000) ?? '',
          platform: jobData.platform ?? 'Unknown',
          budget: jobData.budget ?? 'Negotiable',
          clientName: jobData.clientName ?? '',
          opportunityId: jobData.id,
          skills: jobData.skills ?? [],
          paymentVerified: jobData.paymentVerified ?? false,
          jobsPosted: jobData.jobsPosted ?? null,
          proposalCount: jobData.proposalCount ?? null,
          interviewingCount: jobData.interviewingCount ?? null,
          experienceLevel: jobData.experienceLevel ?? '',
          duration: jobData.duration ?? '',
          connectsRequired: jobData.connections ?? null,
          budgetType: jobData.budgetType ?? '',
          rating: jobData.client?.rating ?? null,
          totalSpent: jobData.client?.totalSpent ?? null,
          totalHires: jobData.client?.totalHires ?? null,
        }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      const data: Analysis = await res.json();
      setAnalysis(data);
      setBidAmount(data.bidAmount ?? '');
      let finalProposal = data.proposal ?? '';
      const client = jobData.clientName && !jobData.clientName.toLowerCase().includes('client') ? jobData.clientName : 'there';
      if (!finalProposal.toLowerCase().startsWith('hi ') && !finalProposal.toLowerCase().startsWith('dear ')) {
        finalProposal = `Hi ${client},\n\n${finalProposal}`;
      }
      setProposalDraft(finalProposal);
    } catch {
      setError('AI analysis unavailable. You can still view the job and apply manually.');
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
    const role = typeof window !== 'undefined' ? (sessionStorage.getItem('lh_auth_role') || 'guest') : 'guest';

    try {
      await fetch('/api/jobs/applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, applied: nextState, role }),
      });

      // For guests: persist only in sessionStorage (lost on refresh by design)
      if (role !== 'admin' && typeof window !== 'undefined') {
        const guestApplied: string[] = JSON.parse(sessionStorage.getItem('guest_applied') || '[]');
        if (nextState) {
          if (!guestApplied.includes(job.id)) guestApplied.push(job.id);
        } else {
          const idx = guestApplied.indexOf(job.id);
          if (idx >= 0) guestApplied.splice(idx, 1);
        }
        sessionStorage.setItem('guest_applied', JSON.stringify(guestApplied));
      }

      setJob(prev => prev ? { ...prev, applied: nextState } : prev);
    } catch {/* non-critical */}
  };

  const copyProposal = async () => {
    try {
      await navigator.clipboard.writeText(proposalDraft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {/* ignore */}
  };

  /* ── LOADING ── */
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

  const expLevel = cleanExpLevel(job.experienceLevel);
  const hasCountry = job.country && job.country.toLowerCase() !== 'remote' && job.country.trim() !== '';
  const skills = job.skills || [];

  /* ── RENDER ── */
  return (
    <div style={s.page} className="lj-page">
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @media (max-width: 768px) {
          .lj-page { height: auto !important; overflow: visible !important; }
          .lj-layout { grid-template-columns: 1fr !important; overflow: visible !important; }
          .lj-left { border-right: none !important; }
        }
      `}</style>
      <AdminLoginModal
        isOpen={showAuthModal}
        onClose={() => router.push('/')}
        onSuccess={() => setShowAuthModal(false)}
      />

      {/* ── TOP BAR ── */}
      <div style={s.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/')} style={s.backBtn}>
            ← Dashboard
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Lead Hunter" style={{ height: 30, width: 'auto', cursor: 'pointer' }} onClick={() => router.push('/')} />
          <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', cursor: 'pointer' }} onClick={() => router.push('/')}>Lead Hunter</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...s.badge, background: PLATFORM_COLORS[job.platform] ?? '#6c5ce7' }}>{job.platform}</span>
          {job.isNew && <span style={{ ...s.badge, background: '#22c55e' }}>New</span>}
          {job.applied && <span style={{ ...s.badge, background: '#3b82f6' }}>Applied</span>}
          <span style={s.timeAgo}>Posted {timeAgo(job.postedAt)}</span>
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div style={s.layout} className="lj-layout">

        {/* ──── LEFT PANEL ──── */}
        <section style={s.leftPanel} className="lj-left">

          {/* Title */}
          <h1 style={s.title}>{job.title}</h1>

          {/* Posted + Location */}
          <div style={s.metaLine}>
            <span style={s.metaDot}>Posted {timeAgo(job.postedAt)}</span>
            {hasCountry && (
              <>
                <span style={s.sep}>·</span>
                <span style={s.metaDot}>{job.country}</span>
              </>
            )}
          </div>

          {/* Job Specs Row — Budget, Experience, Type */}
          <div style={s.specRow}>
            {job.budget && job.budget !== 'Negotiable' && (
              <div style={s.specBox}>
                <div style={s.specVal}>{job.budget}</div>
                <div style={s.specKey}>{job.budgetType || 'Budget'}</div>
              </div>
            )}
            {expLevel && (
              <div style={s.specBox}>
                <div style={s.specVal}>{expLevel}</div>
                <div style={s.specKey}>Experience Level</div>
              </div>
            )}
            {job.duration && (
              <div style={s.specBox}>
                <div style={s.specVal}>{job.duration}</div>
                <div style={s.specKey}>Duration</div>
              </div>
            )}
            {(job.connections ?? 0) > 0 && (
              <div style={s.specBox}>
                <div style={{ ...s.specVal, color: '#2563eb' }}>{job.connections} Connects</div>
                <div style={s.specKey}>Required to Bid</div>
              </div>
            )}
          </div>

          {/* Match score */}
          <div style={s.scoreRow}>
            <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>Match Score</span>
            <span style={{ ...s.scorePct, color: getScoreColor(job.score) }}>{job.score}%</span>
            <div style={s.barTrack}>
              <div style={{ ...s.barFill, width: `${job.score}%`, background: getScoreColor(job.score) }} />
            </div>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {job.score >= 70 ? 'Strong fit' : job.score >= 50 ? 'Promising' : 'Low match'}
            </span>
          </div>

          <hr style={s.divider} />

          {/* Description */}
          <div>
            <h3 style={s.sectionHead}>Project Description</h3>
            <div style={s.descBody}>{job.description || 'No description provided.'}</div>
          </div>

          {/* Skills */}
          {skills.length > 0 && (
            <div>
              <h3 style={s.sectionHead}>Skills & Expertise</h3>
              <div style={s.skillsWrap}>
                {skills.map((sk, i) => (
                  <span key={i} style={s.skillChip}>{sk}</span>
                ))}
              </div>
            </div>
          )}

          {/* Activity on this job */}
          {(job.proposalCount != null || job.interviewingCount != null) && (
            <div>
              <h3 style={s.sectionHead}>Activity on this Job</h3>
              <div style={s.activityRow}>
                {job.proposalCount != null && (
                  <span style={s.actItem}>Proposals: <strong>{job.proposalCount}</strong></span>
                )}
                {(job.interviewingCount ?? 0) > 0 && (
                  <span style={s.actItem}>Interviewing: <strong>{job.interviewingCount}</strong></span>
                )}
                {(job.hiresCount ?? 0) > 0 && (
                  <span style={s.actItem}>Hires: <strong>{job.hiresCount}</strong></span>
                )}
              </div>
            </div>
          )}

          {/* About the client */}
          {(hasCountry || job.clientSpend || job.clientRating || job.paymentVerified || job.jobsPosted) && (
            <div>
              <h3 style={s.sectionHead}>About the Client</h3>
              <div style={s.clientGrid}>
                {hasCountry && (
                  <div style={s.clientItem}>
                    <div style={s.clientLabel}>Location</div>
                    <div style={s.clientVal}>{job.country}</div>
                  </div>
                )}
                {job.clientSpend && (
                  <div style={s.clientItem}>
                    <div style={s.clientLabel}>Total Spent</div>
                    <div style={{ ...s.clientVal, color: '#0f172a', fontWeight: 700 }}>{job.clientSpend}</div>
                  </div>
                )}
                {job.clientRating && (
                  <div style={s.clientItem}>
                    <div style={s.clientLabel}>Rating</div>
                    <div style={{ ...s.clientVal, color: '#f59e0b', fontWeight: 700 }}>{job.clientRating} ★</div>
                  </div>
                )}
                {job.paymentVerified && (
                  <div style={s.clientItem}>
                    <div style={s.clientLabel}>Payment</div>
                    <div style={{ ...s.clientVal, color: '#16a34a' }}>Verified</div>
                  </div>
                )}
                {job.jobsPosted != null && (
                  <div style={s.clientItem}>
                    <div style={s.clientLabel}>Jobs Posted</div>
                    <div style={s.clientVal}>{job.jobsPosted}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={s.actions}>
            <button onClick={openListing} style={s.btnPrimary}>View on {job.platform}</button>
            <button onClick={markApplied} style={job.applied ? s.btnApplied : s.btnSecondary}>
              {job.applied ? 'Applied' : 'Mark as Applied'}
            </button>
          </div>
        </section>

        {/* ──── RIGHT PANEL: AI ANALYSIS ──── */}
        <aside style={s.rightPanel} className="lj-right">

          {analyzing && (
            <div style={s.card}>
              <div style={s.sectionHead}>Generating AI Proposal…</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: 10 }}>
                <div style={s.spinner} />
                <p style={s.muted}>Reading the job, extracting requirements, writing a tailored proposal.</p>
              </div>
            </div>
          )}

          {error && !analyzing && (
            <div style={s.warnBox}>{error}</div>
          )}

          {!analyzing && analysis && (
            <>
              {/* AI Score / Risk / ETA */}
              <div style={s.card}>
                <div style={{ ...s.sectionHead, display: 'flex', alignItems: 'center', gap: 8 }}>
                  AI Assessment
                  {analysis.cached && (
                    <span style={{ ...s.badge, background: '#dbeafe', color: '#1e40af', padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                      Cached (24h)
                    </span>
                  )}
                </div>
                <div style={s.verdictGrid}>
                  <div style={s.verdictCell}>
                    <div style={s.vLabel}>Score</div>
                    <div style={{ ...s.vValue, color: getScoreColor(analysis.score) }}>{analysis.score}/100</div>
                  </div>
                  <div style={s.verdictCell}>
                    <div style={s.vLabel}>Risk Level</div>
                    <div style={{ ...s.vValue, color: analysis.risk === 'Low' ? '#16a34a' : analysis.risk === 'High' ? '#dc2626' : '#d97706' }}>
                      {analysis.risk}
                    </div>
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
                  <div style={s.sectionHead}>Opportunity Summary</div>
                  <p style={s.muted}>{analysis.summary}</p>
                </div>
              )}

              {/* Technical blockers */}
              {(analysis.technicalBlockers?.length ?? 0) > 0 && (
                <div style={s.card}>
                  <div style={s.sectionHead}>Technical Considerations</div>
                  <ul style={s.list}>
                    {analysis.technicalBlockers!.map((b, i) => <li key={i} style={s.listItem}>{b}</li>)}
                  </ul>
                  {(analysis.blockerSolutions?.length ?? 0) > 0 && (
                    <>
                      <div style={{ ...s.sectionHead, marginTop: 12 }}>Suggested Approach</div>
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
                  <div style={s.sectionHead}>Questions to Ask Client</div>
                  <ol style={{ ...s.list, paddingLeft: 18 }}>
                    {analysis.questions.map((q, i) => <li key={i} style={s.listItem}>{q}</li>)}
                  </ol>
                </div>
              )}

              {/* Proposal */}
              <div style={s.card}>
                <div style={s.sectionHead}>Proposal</div>
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

/* ── STYLES — Upwork-inspired clean typography ── */
const s: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#f7f9fc',
    fontFamily: '"Inter","Segoe UI",system-ui,sans-serif',
    color: '#1f2937',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: 8,
  },
  backBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600, padding: '4px 0' },
  badge: { color: '#fff', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 600 },
  timeAgo: { fontSize: 12, color: '#9ca3af' },
  layout: { display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, overflow: 'hidden' },

  /* LEFT */
  leftPanel: {
    padding: '20px 24px',
    overflowY: 'auto',
    borderRight: '1px solid #e5e7eb',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  title: { fontSize: 22, fontWeight: 700, color: '#111827', lineHeight: 1.35, margin: 0 },
  metaLine: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6b7280' },
  metaDot: { color: '#6b7280' },
  sep: { color: '#d1d5db' },

  specRow: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  specBox: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '10px 16px',
    minWidth: 100,
  },
  specVal: { fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 2 },
  specKey: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' },

  scoreRow: { display: 'flex', alignItems: 'center', gap: 10 },
  scorePct: { fontSize: 18, fontWeight: 800, minWidth: 42 },
  barTrack: { flex: 1, height: 5, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.4s' },

  divider: { border: 'none', borderTop: '1px solid #f3f4f6', margin: 0 },

  sectionHead: { fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 10px', letterSpacing: '-0.01em' },
  descBody: { fontSize: 14, color: '#374151', lineHeight: 1.75, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' },

  skillsWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  skillChip: {
    background: '#f3f4f6',
    color: '#374151',
    borderRadius: 999,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid #e5e7eb',
  },

  activityRow: { display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: '#4b5563' },
  actItem: { fontSize: 13, color: '#4b5563' },

  clientGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(140px,100%),1fr))', gap: 10 },
  clientItem: { background: '#f9fafb', borderRadius: 8, padding: '10px 12px', border: '1px solid #e5e7eb' },
  clientLabel: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  clientVal: { fontSize: 14, fontWeight: 600, color: '#374151' },

  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 },
  btnPrimary: { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  btnSecondary: { background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnApplied: { background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

  /* RIGHT */
  rightPanel: { padding: '16px', overflowY: 'auto', background: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 12 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px' },

  verdictGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100px,100%),1fr))', gap: 8, marginTop: 12, textAlign: 'center' },
  verdictCell: { background: '#f9fafb', borderRadius: 8, padding: '10px 4px' },
  vLabel: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  vValue: { fontSize: 16, fontWeight: 800, color: '#111827' },

  muted: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: 0 },
  list: { paddingLeft: 16, margin: 0 },
  listItem: { fontSize: 13, color: '#374151', lineHeight: 1.65, marginBottom: 5 },

  bidRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(150px,100%),1fr))', gap: 10, marginBottom: 12 },
  bidCell: { background: '#f9fafb', borderRadius: 8, padding: '10px 12px' },
  bidInput: { width: '100%', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', fontSize: 14, fontWeight: 700, color: '#111827', background: 'transparent', boxSizing: 'border-box' },
  proposalTA: {
    width: '100%', minHeight: 180, maxHeight: 380,
    border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '10px 12px', fontSize: 13, lineHeight: 1.65,
    color: '#374151', background: '#f9fafb',
    resize: 'vertical', marginBottom: 10,
    boxSizing: 'border-box', display: 'block',
    fontFamily: '"Inter","Segoe UI",sans-serif',
  },
  warnBox: { background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e' },

  loadingCenter: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' },
  spinner: { width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#16a34a', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', border: '1px solid #fecaca', borderRadius: 12, padding: 32, textAlign: 'center', margin: 24 },
};