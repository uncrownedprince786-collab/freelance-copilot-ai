'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatTime12 } from '@/lib/format';

interface SkillTrend {
  skill: string;
  count: number;
  growth: string;
  avgBudget: string;
}

interface CategoryTrend {
  category: string;
  count: number;
  trend: 'high' | 'moderate' | 'steady';
}

interface BudgetInsight {
  range: string;
  count: number;
  pct: number;
}

interface RecommendedSkill {
  skill: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

interface TrendsData {
  topSkills: SkillTrend[];
  topCategories: CategoryTrend[];
  budgetInsights: BudgetInsight[];
  aiInsights: string[];
  recommendedSkillsToLearn: RecommendedSkill[];
  marketSummary: string;
  totalJobsAnalyzed: number;
  cached: boolean;
  generatedAt: string;
}

const URGENCY: Record<string, { border: string; label: string; labelColor: string; bg: string }> = {
  high:   { border: '#dc2626', label: 'High Priority',  labelColor: '#dc2626', bg: '#fef2f2' },
  medium: { border: '#f59e0b', label: 'Medium',         labelColor: '#b45309', bg: '#fffbeb' },
  low:    { border: '#16a34a', label: 'Nice to Have',   labelColor: '#15803d', bg: '#f0fdf4' },
};

// Demand level by observed listing frequency (not a temporal trend).
const TREND_COLORS: Record<string, string> = { high: '#16a34a', moderate: '#2563eb', steady: '#6b7280' };
const TREND_LABELS: Record<string, string> = { high: 'High demand', moderate: 'Moderate demand', steady: 'Steady demand' };

export default function TrendsPage() {
  const router = useRouter();
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { fetchTrends(); }, []);

  const fetchTrends = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/trends');
      if (!res.ok) throw new Error('Failed to fetch trends');
      setData(await res.json());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const maxSkillCount = data?.topSkills?.[0]?.count || 1;

  return (
    <div style={s.page} className="lh-page">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        .fade-up { animation: fadeUp 0.35s ease both; }
      `}</style>

      <div style={s.shell}>

        {/* Header */}
        <header style={s.header} className="lh-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => router.push('/')}>
            <div>
              <div className="lh-h" style={s.brand}>Lead Hunter</div>
              <div style={s.slogan}>Stop scrolling. Start winning</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ThemeToggle />
            <button onClick={() => router.push('/')} style={s.backBtn} className="lh-field">← Dashboard</button>
          </div>
        </header>

        {/* Page heading */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Market Trends</h1>
          <p className="lh-body" style={s.pageDesc}>
            Analysis of collected freelance listings — see what skills are in demand, where budgets fall,
            and which skills appear most often. Updates automatically after each sync.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill} className="lh-field">{data.totalJobsAnalyzed} jobs analysed</span>
              <span style={s.metaPill} className="lh-field">Updated {formatTime12(data.generatedAt)}</span>
              <span style={{ ...s.metaPill, background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' }}>Auto-updates with each sync</span>
            </div>
          )}
        </div>

        {loading ? (
          <div style={s.center}>
            <div style={s.spinner} />
            <p className="lh-muted" style={{ color: '#6b7280', marginTop: 14, fontSize: 14 }}>Analysing job market with AI…</p>
          </div>
        ) : error ? (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button onClick={fetchTrends} style={s.backBtn} className="lh-field">Retry</button>
          </div>
        ) : data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Market Summary */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Market Overview</h2>
              <p style={s.bodyText}>{data.marketSummary}</p>
            </div>

            {/* Top Skills */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Top Skills in Demand</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                {data.topSkills.length ? (
                  data.topSkills.map((sk, i) => (
                    <div key={sk.skill} style={s.skillRow}>
                      <span className="lh-muted" style={s.rank}>#{i + 1}</span>
                      <span className="lh-h" style={s.skillName}>{sk.skill}</span>
                      <span className={i >= 7 ? 'lh-field' : undefined} style={{ ...s.trendTag, color: i < 3 ? '#16a34a' : i < 7 ? '#2563eb' : '#6b7280', background: i < 3 ? '#f0fdf4' : i < 7 ? '#eff6ff' : '#f9fafb' }}>
                        {sk.growth}
                      </span>
                      <div style={{ flex: 1, margin: '0 12px' }}>
                        <div style={s.barTrack}>
                          <div style={{ ...s.barFill, width: `${Math.round(sk.count / maxSkillCount * 100)}%`, background: i < 3 ? '#16a34a' : i < 7 ? '#2563eb' : '#94a3b8' }} />
                        </div>
                      </div>
                      <span className="lh-muted" style={s.countLabel}>{sk.count} jobs</span>
                    </div>
                  ))
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>Not enough data yet to rank skills in demand.</p>
                )}
              </div>
            </div>

            {/* Categories + Budget */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))', gap: 20 }}>

              {/* Categories */}
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Job Categories</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                  {data.topCategories.length ? (
                    data.topCategories.map(cat => (
                      <div key={cat.category} style={s.catRow}>
                        <div style={{ flex: 1 }}>
                          <div className="lh-h" style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{cat.category}</div>
                          <div style={{ fontSize: 11, color: TREND_COLORS[cat.trend], fontWeight: 600, marginTop: 2 }}>
                            {TREND_LABELS[cat.trend]}
                          </div>
                        </div>
                        <span className={cat.trend === 'high' ? undefined : 'lh-field'} style={{ ...s.countBadge, background: cat.trend === 'high' ? '#f0fdf4' : '#f9fafb', color: cat.trend === 'high' ? '#15803d' : '#374151', border: `1px solid ${cat.trend === 'high' ? '#bbf7d0' : '#e5e7eb'}` }}>
                          {cat.count}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="lh-muted" style={s.emptyNote}>Not enough data yet to identify job categories.</p>
                  )}
                </div>
              </div>

              {/* Budget Distribution */}
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Budget Distribution</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                  {data.budgetInsights.filter(b => b.count > 0).map(b => (
                    <div key={b.range}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span className="lh-body" style={{ fontWeight: 600, color: '#374151' }}>{b.range}</span>
                        <span className="lh-muted" style={{ color: '#6b7280' }}>{b.count} jobs ({b.pct}%)</span>
                      </div>
                      <div style={s.barTrack}>
                        <div style={{ ...s.barFill, width: `${b.pct}%`, background: '#2563eb' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Insights */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>AI Market Insights</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 10, marginTop: 4 }}>
                {data.aiInsights.length ? (
                  data.aiInsights.map((insight, i) => (
                    <div key={i} style={s.insightCard} className="lh-surface">
                      <p className="lh-body" style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, margin: 0 }}>{insight}</p>
                    </div>
                  ))
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>Not enough data yet to generate reliable AI market insights.</p>
                )}
              </div>
            </div>

            {/* Skills to Learn */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Skills to Learn Next</h2>
              <p className="lh-muted" style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 14px' }}>
                Prioritised by market demand and earning potential — based on current Upwork job data.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.recommendedSkillsToLearn.length ? (
                  data.recommendedSkillsToLearn.map((sk, i) => {
                    const uc = URGENCY[sk.urgency] ?? URGENCY.medium;
                    return (
                      <div key={i} style={{ ...s.learnCard, borderLeft: `3px solid ${uc.border}`, background: uc.bg }} className="lh-surface">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div>
                            <div className="lh-h" style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 4 }}>{sk.skill}</div>
                            <div className="lh-body" style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.55 }}>{sk.reason}</div>
                          </div>
                          <span style={{ ...s.urgencyTag, background: uc.border, color: '#fff', whiteSpace: 'nowrap' }}>
                            {uc.label}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="lh-muted" style={s.emptyNote}>More market data is needed to identify reliable emerging skills.</p>
                )}
              </div>
            </div>

          </div>
        )}

        <footer className="lh-muted" style={s.footer}>
          Developed by Abdul Raheem &middot; geeksxperts@gmail.com &middot; Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f7f9fc', padding: '24px 16px', fontFamily: '"Inter","Segoe UI",system-ui,sans-serif', color: '#111827' },
  shell: { maxWidth: 960, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#16a34a', fontWeight: 600, marginTop: 1 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  refreshBtn: { background: '#1d4ed8', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer' },
  pageHead: { marginBottom: 28 },
  pageTitle: { fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#6b7280', lineHeight: 1.65, margin: '0 0 12px', maxWidth: 680 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },
  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: '0 0 2px', letterSpacing: '-0.01em' },
  bodyText: { fontSize: 14, color: '#374151', lineHeight: 1.75, margin: '10px 0 0' },
  skillRow: { display: 'flex', alignItems: 'center', gap: 8 },
  rank: { fontSize: 12, fontWeight: 700, color: '#9ca3af', minWidth: 26 },
  skillName: { fontSize: 13, fontWeight: 600, color: '#111827', minWidth: 130 },
  trendTag: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, minWidth: 50, textAlign: 'center' },
  barTrack: { height: 6, background: '#f3f4f6', borderRadius: 999, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.5s ease' },
  countLabel: { fontSize: 12, color: '#6b7280', minWidth: 52, textAlign: 'right' },
  catRow: { display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f9fafb' },
  countBadge: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  insightCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  learnCard: { borderRadius: 8, padding: '14px 16px' },
  urgencyTag: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },
  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
