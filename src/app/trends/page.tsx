'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SkillTrend {
  skill: string;
  count: number;
  growth: string;
  avgBudget: string;
}

interface CategoryTrend {
  category: string;
  count: number;
  trend: 'rising' | 'stable' | 'declining';
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

const URGENCY_COLOR = { high: { bg: '#fef2f2', text: '#b91c1c', label: '🔥 High Priority' }, medium: { bg: '#fef9c3', text: '#92400e', label: '📈 Medium' }, low: { bg: '#f0fdf4', text: '#15803d', label: '✅ Nice to Have' } };
const TREND_COLOR = { rising: '#16a34a', stable: '#2563eb', declining: '#dc2626' };

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
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const maxSkillCount = data?.topSkills?.[0]?.count || 1;

  return (
    <div style={s.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity:0;transform:translateY(12px);} to{opacity:1;transform:none;} } .trend-card { animation: fadeIn 0.4s ease both; }`}</style>
      <div style={s.shell}>

        {/* Header */}
        <header style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => router.push('/')}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Lead Hunter" style={{ height: 42, width: 'auto' }} />
            <div>
              <h1 style={s.brand}>Lead Hunter</h1>
              <p style={s.slogan}>Stop scrolling. Start winning</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={fetchTrends} style={s.refreshBtn}>🔄 Refresh Analysis</button>
            <button onClick={() => router.push('/')} style={s.backBtn}>← Dashboard</button>
          </div>
        </header>

        {/* Page Title */}
        <div style={s.heroSection}>
          <div style={s.heroBadge}>📊 AI-Powered Market Intelligence</div>
          <h2 style={s.heroTitle}>Upwork Market Trends</h2>
          <p style={s.heroSubtitle}>
            Real-time analysis of active Upwork jobs — discover what skills clients are hiring for, where the market is heading, and what to learn next to win more contracts.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill}>📋 {data.totalJobsAnalyzed} jobs analyzed</span>
              <span style={s.metaPill}>🕐 Updated {new Date(data.generatedAt).toLocaleTimeString()}</span>
              {data.cached && <span style={{ ...s.metaPill, background: '#fef9c3', color: '#92400e' }}>⚡ Cached — refreshes every 4h</span>}
            </div>
          )}
        </div>

        {loading ? (
          <div style={s.centerBox}>
            <div style={s.spinner} />
            <p style={{ color: '#64748b', marginTop: 16, fontSize: 14 }}>Analyzing job market with AI…<br /><span style={{ fontSize: 12, color: '#94a3b8' }}>This may take a moment</span></p>
          </div>
        ) : error ? (
          <div style={s.errorBox}>
            <p style={{ fontWeight: 700, color: '#dc2626' }}>⚠️ {error}</p>
            <button onClick={fetchTrends} style={s.backBtn}>Retry</button>
          </div>
        ) : data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* Market Summary */}
            <div className="trend-card" style={s.summaryCard}>
              <div style={s.sectionHeader}>🌐 Market Overview</div>
              <p style={{ fontSize: 15, color: '#1e293b', lineHeight: 1.75, margin: 0 }}>{data.marketSummary}</p>
            </div>

            {/* Top Skills */}
            <div className="trend-card" style={s.card}>
              <div style={s.sectionHeader}>🛠️ Top Skills in Demand</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.topSkills.map((sk, i) => (
                  <div key={sk.skill} style={s.skillRow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 220 }}>
                      <span style={s.rank}>#{i + 1}</span>
                      <span style={s.skillName}>{sk.skill}</span>
                      <span style={s.growthBadge}>{sk.growth}</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={s.barTrack}>
                        <div style={{ ...s.barFill, width: `${Math.round(sk.count / maxSkillCount * 100)}%`, background: i < 3 ? '#16a34a' : i < 7 ? '#2563eb' : '#94a3b8' }} />
                      </div>
                    </div>
                    <span style={s.skillCount}>{sk.count} jobs</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Categories + Budget side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Categories */}
              <div className="trend-card" style={s.card}>
                <div style={s.sectionHeader}>📂 Top Job Categories</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.topCategories.map(cat => (
                    <div key={cat.category} style={s.catRow}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{cat.category}</div>
                        <div style={{ fontSize: 11, color: TREND_COLOR[cat.trend], fontWeight: 600, marginTop: 2 }}>
                          {cat.trend === 'rising' ? '📈 Rising' : cat.trend === 'declining' ? '📉 Declining' : '→ Stable'}
                        </div>
                      </div>
                      <span style={{ ...s.catCount, background: cat.trend === 'rising' ? '#dcfce7' : '#f1f5f9', color: cat.trend === 'rising' ? '#15803d' : '#475569' }}>
                        {cat.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Budget Distribution */}
              <div className="trend-card" style={s.card}>
                <div style={s.sectionHeader}>💰 Budget Distribution</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.budgetInsights.map(b => (
                    <div key={b.range}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, color: '#334155' }}>{b.range}</span>
                        <span style={{ color: '#64748b' }}>{b.count} jobs ({b.pct}%)</span>
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
            <div className="trend-card" style={s.card}>
              <div style={s.sectionHeader}>🤖 AI Market Insights</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {data.aiInsights.map((insight, i) => (
                  <div key={i} style={s.insightCard}>
                    <span style={s.insightIcon}>💡</span>
                    <p style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.6, margin: 0 }}>{insight}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Skills to Learn */}
            <div className="trend-card" style={s.card}>
              <div style={s.sectionHeader}>🎯 Skills You Should Learn Next</div>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Based on current market demand — prioritized by opportunity size and growth rate.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.recommendedSkillsToLearn.map((sk, i) => {
                  const uc = URGENCY_COLOR[sk.urgency];
                  return (
                    <div key={i} style={{ ...s.learnCard, borderLeft: `4px solid ${uc.text}`, background: uc.bg }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>{sk.skill}</div>
                          <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.55 }}>{sk.reason}</div>
                        </div>
                        <span style={{ ...s.urgencyBadge, background: uc.text, color: '#fff', whiteSpace: 'nowrap' }}>{uc.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer style={{ textAlign: 'center', marginTop: 48, padding: '16px 0', borderTop: '1px solid #e2e8f0', color: '#94a3b8', fontSize: 12 }}>
          Developed by Abdul Raheem · geeksxperts@gmail.com · Lead Hunter
        </footer>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)', padding: '24px 16px', fontFamily: 'Inter,"Segoe UI",sans-serif' },
  shell: { maxWidth: 1000, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' },
  brand: { fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 },
  slogan: { fontSize: 12, color: '#16a34a', fontWeight: 600, margin: '2px 0 0' },
  backBtn: { background: '#fff', border: '1px solid #dbe2ea', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#2563eb', cursor: 'pointer' },
  refreshBtn: { background: '#2563eb', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer' },
  heroSection: { textAlign: 'center', marginBottom: 32, padding: '32px 20px', background: 'linear-gradient(135deg,#1e40af,#16a34a)', borderRadius: 20, color: '#fff' },
  heroBadge: { display: 'inline-block', background: 'rgba(255,255,255,0.2)', borderRadius: 999, padding: '4px 16px', fontSize: 12, fontWeight: 700, marginBottom: 12 },
  heroTitle: { fontSize: 32, fontWeight: 900, margin: '8px 0', color: '#fff' },
  heroSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, maxWidth: 600, margin: '0 auto 16px' },
  metaRow: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },
  metaPill: { background: 'rgba(255,255,255,0.2)', borderRadius: 999, padding: '4px 14px', fontSize: 12, fontWeight: 600, color: '#fff' },
  centerBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 36, height: 36, border: '3px solid #dbeafe', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 14, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },
  card: { background: '#fff', borderRadius: 16, padding: '20px 24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(15,23,42,0.06)' },
  summaryCard: { background: 'linear-gradient(135deg,#f0fdf4,#ecfdf5)', borderRadius: 16, padding: '20px 24px', border: '1px solid #bbf7d0' },
  sectionHeader: { fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 16 },
  skillRow: { display: 'flex', alignItems: 'center', gap: 12 },
  rank: { fontSize: 12, fontWeight: 700, color: '#94a3b8', minWidth: 24 },
  skillName: { fontSize: 13, fontWeight: 700, color: '#0f172a', minWidth: 120 },
  growthBadge: { fontSize: 10, fontWeight: 700, color: '#475569' },
  skillCount: { fontSize: 12, fontWeight: 700, color: '#64748b', minWidth: 54, textAlign: 'right' },
  barTrack: { height: 8, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.6s ease' },
  catRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f8fafc' },
  catCount: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 },
  insightCard: { display: 'flex', gap: 10, background: '#f8fafc', borderRadius: 10, padding: '12px 14px', alignItems: 'flex-start' },
  insightIcon: { fontSize: 16, marginTop: 1 },
  learnCard: { borderRadius: 10, padding: '14px 18px' },
  urgencyBadge: { fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999 },
};
