'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface OptimizedProfile {
  title: string;
  overview: string;
  skills: string[];
  positioning: string;
  targetClients: string;
  portfolioRecommendations: string[];
  callToAction: string;
}

interface PriorityAction {
  priority: 'high' | 'medium' | 'low';
  action: string;
  reason: string;
}

interface AnalysisResult {
  overallScore: number;
  scores: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  marketTrends: string[];
  optimizedProfile: OptimizedProfile;
  priorityActions: PriorityAction[];
}

interface AnalyzeResponse {
  ok: boolean;
  platform: string;
  fromExtraction: boolean;
  manualNote?: string;
  provider: string | null;
  result: AnalysisResult;
  error?: string;
}

const PLATFORM_COLORS: Record<string, string> = { upwork: '#14a800', freelancer: '#29b2fe' };
const PRIORITY_COLORS: Record<string, { border: string; label: string; bg: string }> = {
  high:   { border: '#dc2626', label: 'High',   bg: '#fef2f2' },
  medium: { border: '#f59e0b', label: 'Medium', bg: '#fffbeb' },
  low:    { border: '#16a34a', label: 'Low',    bg: '#f0fdf4' },
};

const CATEGORY_LABELS: Record<string, string> = {
  title: 'Title',
  overview: 'Overview',
  skills: 'Skills',
  positioning: 'Positioning',
  portfolio: 'Portfolio',
  clientFocus: 'Client Focus',
};

function scoreColor(score: number): string {
  if (score >= 75) return '#16a34a';
  if (score >= 50) return '#2563eb';
  return '#dc2626';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button onClick={copy} style={s.copyBtn}>
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [profileUrl, setProfileUrl] = useState('');
  const [manualProfile, setManualProfile] = useState('');
  const [inputMode, setInputMode] = useState<'url' | 'paste'>('url');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AnalyzeResponse | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await fetch('/api/profile/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl: inputMode === 'url' ? profileUrl : '',
          manualProfile: inputMode === 'paste' ? manualProfile : '',
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || `Request failed (${res.status})`);
      }
      setData(payload);
      const skills = payload?.result?.optimizedProfile?.skills;
      if (Array.isArray(skills)) {
        sessionStorage.setItem('lh_profile_skills', JSON.stringify(skills.slice(0, 15)));
      }
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError((e as any).message || 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const platformColor = data ? PLATFORM_COLORS[data.platform] ?? '#2563eb' : '#2563eb';
  const result = data?.result;

  return (
    <div style={s.page}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        .fade-up { animation: fadeUp 0.35s ease both; }
      `}</style>

      <div style={s.shell}>

        {/* Header */}
        <header style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => router.push('/')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Lead Hunter" style={{ height: 38, width: 'auto' }} />
            <div>
              <div style={s.brand}>Lead Hunter</div>
              <div style={s.slogan}>Stop scrolling. Start winning</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => router.push('/')} style={s.backBtn}>← Dashboard</button>
          </div>
        </header>

        {/* Page heading */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Profile Market Trend &amp; Optimizer</h1>
          <p style={s.pageDesc}>
            Paste your Upwork or Freelancer profile URL, or copy in your profile text. Get a market-trend
            analysis, a scored breakdown of your profile, and an optimized title, overview, and skills list
            you can use directly.
          </p>
        </div>

        {/* Input card */}
        <div style={s.card}>
          <div style={s.tabRow}>
            <button onClick={() => setInputMode('url')} style={inputMode === 'url' ? { ...s.tab, ...s.tabActive } : s.tab}>
              Profile URL
            </button>
            <button onClick={() => setInputMode('paste')} style={inputMode === 'paste' ? { ...s.tab, ...s.tabActive } : s.tab}>
              Paste Profile
            </button>
          </div>

          {inputMode === 'url' ? (
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <input
                value={profileUrl}
                onChange={(e) => setProfileUrl(e.target.value)}
                placeholder="https://www.upwork.com/freelancers/~yourhandle"
                style={s.input}
              />
            </div>
          ) : (
            <textarea
              value={manualProfile}
              onChange={(e) => setManualProfile(e.target.value)}
              placeholder="Paste your full profile text here (name, title, overview, skills, portfolio)..."
              style={s.textarea}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <button
              onClick={analyze}
              disabled={loading || (inputMode === 'url' ? !profileUrl.trim() : !manualProfile.trim())}
              style={{ ...s.analyzeBtn, opacity: loading || (inputMode === 'url' ? !profileUrl.trim() : !manualProfile.trim()) ? 0.5 : 1, cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading ? 'Analyzing…' : 'Analyze My Profile'}
            </button>
            {loading && <div style={s.spinner} />}
          </div>

          {error && (
            <div style={s.errorBox}>
              <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
              {/422|paste/i.test(error) && (
                <button onClick={() => setInputMode('paste')} style={s.backBtn}>Paste profile instead</button>
              )}
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 24 }}>

            {/* Platform note */}
            {data?.manualNote && (
              <div style={s.warnBox}>
                <p style={{ fontSize: 13, color: '#b45309', lineHeight: 1.6, margin: 0 }}>
                  <strong>Note:</strong> {data.manualNote} Analysis used your pasted content instead.
                </p>
              </div>
            )}

            {/* Overall score */}
            <div className="fade-up" style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 style={s.cardTitle}>Profile Strength</h2>
                  <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
                    Overall score for your {data?.platform} profile
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 76, height: 76, borderRadius: '50%', border: `6px solid ${scoreColor(result.overallScore)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 24, fontWeight: 800, color: scoreColor(result.overallScore) }}>{result.overallScore}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: platformColor, padding: '4px 10px', borderRadius: 4, background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                    {data?.platform}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Object.entries(result.scores).map(([cat, score]) => (
                  <div key={cat}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#374151' }}>{CATEGORY_LABELS[cat] ?? cat}</span>
                      <span style={{ color: '#6b7280' }}>{score}/100</span>
                    </div>
                    <div style={s.barTrack}>
                      <div style={{ ...s.barFill, width: `${score}%`, background: scoreColor(score) }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Strengths / Weaknesses / Opportunities */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 16 }}>
              <div className="fade-up" style={s.card}>
                <h2 style={s.cardTitle}>Strengths</h2>
                <ul style={s.list}>
                  {result.strengths.map((item, i) => (
                    <li key={i} style={{ ...s.listItem, color: '#15803d' }}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="fade-up" style={s.card}>
                <h2 style={s.cardTitle}>Weaknesses</h2>
                <ul style={s.list}>
                  {result.weaknesses.map((item, i) => (
                    <li key={i} style={{ ...s.listItem, color: '#b91c1c' }}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="fade-up" style={s.card}>
                <h2 style={s.cardTitle}>Opportunities</h2>
                <ul style={s.list}>
                  {result.opportunities.map((item, i) => (
                    <li key={i} style={{ ...s.listItem, color: '#1d4ed8' }}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Market trends */}
            <div className="fade-up" style={s.card}>
              <h2 style={s.cardTitle}>Market Trends</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 10, marginTop: 10 }}>
                {result.marketTrends.map((trend, i) => (
                  <div key={i} style={s.insightCard}>
                    <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, margin: 0 }}>{trend}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Optimized profile */}
            <div className="fade-up" style={s.card}>
              <h2 style={s.cardTitle}>Optimized Profile</h2>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={s.fieldLabel}>Optimized Title</div>
                  <div style={s.fieldRow}>
                    <div style={s.fieldValue}>{result.optimizedProfile.title}</div>
                    <CopyButton text={result.optimizedProfile.title} />
                  </div>
                </div>
                <div>
                  <div style={s.fieldLabel}>Optimized Overview</div>
                  <div style={s.fieldRow}>
                    <div style={{ ...s.fieldValue, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{result.optimizedProfile.overview}</div>
                    <CopyButton text={result.optimizedProfile.overview} />
                  </div>
                </div>
                {result.optimizedProfile.skills.length > 0 && (
                  <div>
                    <div style={s.fieldLabel}>Optimized Skills</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {result.optimizedProfile.skills.map((skill, i) => (
                        <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }}>{skill}</span>
                      ))}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <CopyButton text={result.optimizedProfile.skills.join(', ')} />
                    </div>
                  </div>
                )}
                <div>
                  <div style={s.fieldLabel}>Positioning Statement</div>
                  <div style={s.fieldRow}>
                    <div style={s.fieldValue}>{result.optimizedProfile.positioning}</div>
                    <CopyButton text={result.optimizedProfile.positioning} />
                  </div>
                </div>
                <div>
                  <div style={s.fieldLabel}>Target Clients</div>
                  <div style={s.fieldRow}>
                    <div style={s.fieldValue}>{result.optimizedProfile.targetClients}</div>
                    <CopyButton text={result.optimizedProfile.targetClients} />
                  </div>
                </div>
                <div>
                  <div style={s.fieldLabel}>Call to Action</div>
                  <div style={s.fieldRow}>
                    <div style={s.fieldValue}>{result.optimizedProfile.callToAction}</div>
                    <CopyButton text={result.optimizedProfile.callToAction} />
                  </div>
                </div>
                {result.optimizedProfile.portfolioRecommendations.length > 0 && (
                  <div>
                    <div style={s.fieldLabel}>Portfolio Recommendations</div>
                    <ul style={s.list}>
                      {result.optimizedProfile.portfolioRecommendations.map((rec, i) => (
                        <li key={i} style={{ ...s.listItem, color: '#374151' }}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Priority actions */}
            {result.priorityActions.length > 0 && (
              <div className="fade-up" style={s.card}>
                <h2 style={s.cardTitle}>Priority Actions</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {result.priorityActions.map((action, i) => {
                    const pc = PRIORITY_COLORS[action.priority] ?? PRIORITY_COLORS.medium;
                    return (
                      <div key={i} style={{ ...s.actionRow, borderLeft: `3px solid ${pc.border}`, background: pc.bg }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{action.action}</div>
                          {action.reason && <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>{action.reason}</div>}
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: pc.border, color: '#fff', whiteSpace: 'nowrap' }}>
                          {pc.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button onClick={() => { setData(null); setError(''); }} style={s.backBtn}>
              Analyze Another Profile
            </button>
          </div>
        )}

        <footer style={s.footer}>
          Developed by Abdul Raheem &middot; geeksxperts@gmail.com &middot; Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f9fc', padding: '24px 16px', fontFamily: '"Inter","Segoe UI",system-ui,sans-serif', color: '#111827' },
  shell: { maxWidth: 900, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#16a34a', fontWeight: 600, marginTop: 1 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  pageHead: { marginBottom: 24 },
  pageTitle: { fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#6b7280', lineHeight: 1.65, margin: 0, maxWidth: 700 },
  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  tabRow: { display: 'flex', gap: 8, borderBottom: '1px solid #e5e7eb', paddingBottom: 10 },
  tab: { background: 'transparent', border: 'none', padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer', borderRadius: 6 },
  tabActive: { background: '#eff6ff', color: '#1d4ed8' },
  input: { flex: 1, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, color: '#111827', background: '#fff' },
  textarea: { width: '100%', minHeight: 160, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, color: '#111827', background: '#fff', fontFamily: 'inherit', resize: 'vertical' },
  analyzeBtn: { background: '#1d4ed8', border: 'none', borderRadius: 6, padding: '10px 18px', fontSize: 13, fontWeight: 700, color: '#fff' },
  spinner: { width: 20, height: 20, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fef2f2', borderRadius: 8, padding: 14, marginTop: 14, border: '1px solid #fecaca' },
  warnBox: { background: '#fffbeb', borderRadius: 8, padding: 14, border: '1px solid #fde68a' },
  barTrack: { height: 6, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.5s ease' },
  list: { margin: '10px 0 0', paddingLeft: 18 },
  listItem: { fontSize: 13, lineHeight: 1.65, marginBottom: 6 },
  insightCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 },
  fieldRow: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  fieldValue: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 1.6, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 12px' },
  copyBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' },
  actionRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderRadius: 8, padding: '12px 14px' },
  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
