'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatTime12 } from '@/lib/format';
import { JobsPerDayChart, HistoryChart, SplitBars, BudgetTrendChart } from '@/components/charts';

interface CategoryTrend {
  category: string;
  count: number;
  trend: 'high' | 'moderate' | 'steady';
}

interface RecommendedSkill {
  skill: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}

interface HourPoint { hour: number; label: string; count: number; }
interface DayPoint { date: string; label: string; count: number; upwork: number; freelancer: number; avgProposals: number | null; avgBudgetUsd: number | null; }

interface MarketIntelligenceData {
  generatedAt: string;
  totalJobs: number;
  dailyVolume: { seven: DayPoint[]; thirty: DayPoint[] };
  avgJobsPerDay7: number;
  avgJobsPerDay30: number;
  marketDirection: 'rising' | 'falling' | 'stable' | 'insufficient';
  marketDirectionPct: number | null;
  marketDirectionReason: string;
  platform: { upwork: number; freelancer: number; other: number; upworkPct: number; freelancerPct: number; otherPct: number };
  mostActiveSkills: { skill: string; count: number }[];
  fastGrowingSkills: { skill: string; count: number; firstHalf: number; secondHalf: number; growthPct: number | null; status: 'growing' | 'new' | 'declining' | 'stable' }[];
  competition: { daily: { date: string; label: string; avgProposals: number | null; jobs: number }[]; direction: string; directionReason: string };
  budgetTrend: { date: string; label: string; avgUsd: number | null; jobs: number }[];
  engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
  peakPostingHours: HourPoint[];
  topMonitorHours: HourPoint[];
  platformPeakHours: { platform: string; hours: HourPoint[] }[];
  retentionNote: string;
}

interface HistoryData {
  available: boolean;
  days: { date: string; label: string; count: number; avgProposals: number | null }[];
  avgProposalsOverall: number | null;
  peakHours: { hour: number; count: number }[];
  topSkills: { skill: string; count: number }[];
  platformSplit: { platform: string; count: number }[];
  weekdaySplit: { day: string; count: number }[];
  note: string;
}

interface TrendsData {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: CategoryTrend[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: RecommendedSkill[];
  marketSummary: string;
  totalJobsAnalyzed: number;
  intelligence: MarketIntelligenceData;
  history: HistoryData | null;
  generatedAt: string;
}

const URGENCY: Record<string, { border: string; label: string; labelColor: string; bg: string }> = {
  high:   { border: '#dc2626', label: 'High Priority',  labelColor: '#dc2626', bg: '#fef2f2' },
  medium: { border: '#f59e0b', label: 'Medium',         labelColor: '#b45309', bg: '#fffbeb' },
  low:    { border: '#16a34a', label: 'Nice to Have',   labelColor: '#15803d', bg: '#f0fdf4' },
};

const DIRECTION_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  rising:      { label: 'Rising',        color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  falling:     { label: 'Falling',       color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  stable:      { label: 'Stable',        color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  insufficient:{ label: 'Insufficient data', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
};

const GROWTH_META: Record<string, { label: string; color: string; arrow: string }> = {
  growing:   { label: 'Growing',  color: '#15803d', arrow: '↗' },
  new:       { label: 'New',      color: '#2563eb', arrow: '✦' },
  declining: { label: 'Declining', color: '#b91c1c', arrow: '↘' },
  stable:    { label: 'Steady',   color: '#6b7280', arrow: '→' },
};

const TREND_COLORS: Record<string, string> = { high: '#16a34a', moderate: '#2563eb', steady: '#6b7280' };
const TREND_LABELS: Record<string, string> = { high: 'High demand', moderate: 'Moderate demand', steady: 'Steady demand' };

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch trends');
    } finally {
      setLoading(false);
    }
  };

  const intel = data?.intelligence;
  const dirMeta = DIRECTION_META[intel?.marketDirection ?? 'insufficient'] ?? DIRECTION_META.insufficient;

  const dailyChart = useMemo(() => {
    if (!intel) return [];
    return intel.dailyVolume.seven.map(d => ({ label: d.label, count: d.count, upwork: d.upwork, freelancer: d.freelancer }));
  }, [intel]);

  const history = data?.history && data.history.available ? data.history : null;
  const historyChart = useMemo(() => (history?.days ?? []).map(d => ({ label: d.label, count: d.count, avgProposals: d.avgProposals })), [history]);
  const historyTotal = historyChart.reduce((a, b) => a + b.count, 0);

  // Derive actionable insights
  const growingSkills = intel?.fastGrowingSkills?.filter(s => s.status === 'growing' || s.status === 'new').slice(0, 5) ?? [];
  const decliningSkills = intel?.fastGrowingSkills?.filter(s => s.status === 'declining').slice(0, 5) ?? [];
  const topCategories = data?.topCategories?.slice(0, 5) ?? [];
  const topMonitorHours = intel?.topMonitorHours?.slice(0, 3) ?? [];
  const platformMix = intel ? { upwork: intel.platform.upworkPct, freelancer: intel.platform.freelancerPct } : null;

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
            What&apos;s happening in the freelance market right now — based on live listings from Upwork and Freelancer.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill} className="lh-field">{intel?.totalJobs ?? data.totalJobsAnalyzed} jobs analyzed</span>
              <span style={s.metaPill} className="lh-field">Updated {formatTime12(intel?.generatedAt || data.generatedAt)}</span>
              <span style={s.metaPill} className="lh-field">Posting times in UTC</span>
            </div>
          )}
        </div>

        {loading ? (
          <div style={s.center}>
            <div style={s.spinner} />
            <p className="lh-muted" style={{ color: '#6b7280', marginTop: 14, fontSize: 14 }}>Computing market intelligence from collected listings…</p>
          </div>
        ) : error ? (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>{error}</p>
            <button onClick={fetchTrends} style={s.backBtn} className="lh-field">Retry</button>
          </div>
        ) : data && intel ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Hero stats ── */}
            <div className="fade-up" style={s.heroGrid}>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Daily Job Volume (7d avg)</div>
                <div className="lh-h" style={s.heroValue}>{fmt(intel.avgJobsPerDay7)} <span style={s.heroUnit}>jobs/day</span></div>
                <div className="lh-muted" style={s.heroSub}>30-day avg: {fmt(intel.avgJobsPerDay30)}/day</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Market Direction</div>
                <div className="lh-h" style={{ ...s.heroValue, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ ...s.dirChip, color: dirMeta.color, background: dirMeta.bg, border: `1px solid ${dirMeta.border}` }}>{dirMeta.label}</span>
                  {intel.marketDirectionPct != null && (
                    <span style={{ fontSize: 13, color: dirMeta.color, fontWeight: 700 }}>{intel.marketDirectionPct >= 0 ? '+' : ''}{intel.marketDirectionPct}%</span>
                  )}
                </div>
                <div className="lh-muted" style={s.heroSub}>vs the 3 days before the window</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Listings in Window</div>
                <div className="lh-h" style={s.heroValue}>{intel.totalJobs}</div>
                <div className="lh-muted" style={s.heroSub}>retained rolling listings</div>
              </div>
              {platformMix && (
                <div style={s.heroCard} className="lh-surface">
                  <div className="lh-muted" style={s.heroLabel}>Platform Mix</div>
                  <div className="lh-h" style={{ ...s.heroValue, fontSize: 20 }}>{platformMix.upwork}% Upwork</div>
                  <div className="lh-muted" style={s.heroSub}>{platformMix.freelancer}% Freelancer</div>
                </div>
              )}
            </div>

            {/* ── 1. What's Trending ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <div style={s.cardHead}>
                <h2 style={s.cardTitle}>What&apos;s Trending</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,1fr)),1fr)', gap: 16 }}>
                {/* Volume trend */}
                <div className="lh-surface" style={s.actionCard}>
                  <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Daily Volume</div>
                  <div className="lh-h" style={{ fontSize: 20 }}>{fmt(intel.avgJobsPerDay7)} jobs/day</div>
                  <div className="lh-muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {intel.marketDirection === 'rising' && '↑ Rising'} {intel.marketDirection === 'falling' && '↓ Falling'} {intel.marketDirection === 'stable' && '→ Stable'}
                    {intel.marketDirectionPct != null && ` (${intel.marketDirectionPct >= 0 ? '+' : ''}${intel.marketDirectionPct}%)`}
                  </div>
                </div>
                {/* Competition */}
                <div className="lh-surface" style={s.actionCard}>
                  <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Competition</div>
                  <div className="lh-h" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ ...s.dirChip, color: DIRECTION_META[intel.competition.direction as string]?.color ?? '#6b7280', background: DIRECTION_META[intel.competition.direction as string]?.bg ?? '#f3f4f6', border: `1px solid ${DIRECTION_META[intel.competition.direction as string]?.border ?? '#e5e7eb'}` }}>
                      {DIRECTION_META[intel.competition.direction as string]?.label ?? '—'}
                    </span>
                  </div>
                  <div className="lh-muted" style={{ fontSize: 12, marginTop: 4 }}>{intel.competition.directionReason}</div>
                </div>
                {/* Budget direction */}
                <div className="lh-surface" style={s.actionCard}>
                  <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Budget Trend</div>
                  <div className="lh-body" style={{ fontSize: 14, lineHeight: 1.6 }}>
                    {intel.budgetTrend.length >= 2 && (() => {
                      const recent = intel.budgetTrend.slice(-3).filter(d => d.avgUsd != null);
                      const older = intel.budgetTrend.slice(-7, -3).filter(d => d.avgUsd != null);
                      if (recent.length && older.length) {
                        const recentAvg = recent.reduce((a, b) => a + (b.avgUsd ?? 0), 0) / recent.length;
                        const olderAvg = older.reduce((a, b) => a + (b.avgUsd ?? 0), 0) / older.length;
                        const pct = ((recentAvg - olderAvg) / olderAvg * 100).toFixed(0);
                        return pct.startsWith('-') ? `↓ ${pct}% vs prior week` : pct.startsWith('0') ? '→ Flat' : `↑ +${pct}% vs prior week`;
                      }
                    })() || 'Insufficient data'}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 2. Skills Gaining Demand ── */}
            {growingSkills.length > 0 && (
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Skills Gaining Demand</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Skills whose appearance is increasing across the 7-day window (older half vs newer half).</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {growingSkills.map(sk => {
                    const gm = GROWTH_META[sk.status];
                    return (
                      <div key={sk.skill} style={{ ...s.growthRow, borderLeft: `3px solid ${gm.color}` }} className="lh-surface">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="lh-h" style={{ fontSize: 13, fontWeight: 700 }}>{sk.skill}</span>
                            <span style={{ ...s.growthTag, color: gm.color, background: gm.color === '#6b7280' ? '#f3f4f6' : undefined }}>
                              {gm.arrow} {gm.label}
                            </span>
                          </div>
                          <div className="lh-muted" style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>
                            {sk.count} appearances · {sk.firstHalf} → {sk.secondHalf}
                            {sk.growthPct != null ? ` (+${sk.growthPct}%)` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 3. Skills Losing Demand ── */}
            {decliningSkills.length > 0 && (
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Skills Losing Demand</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Skills whose appearance is decreasing across the 7-day window.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {decliningSkills.map(sk => {
                    const gm = GROWTH_META[sk.status];
                    return (
                      <div key={sk.skill} style={{ ...s.growthRow, borderLeft: `3px solid ${gm.color}` }} className="lh-surface">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="lh-h" style={{ fontSize: 13, fontWeight: 700 }}>{sk.skill}</span>
                            <span style={{ ...s.growthTag, color: gm.color, background: gm.color === '#6b7280' ? '#f3f4f6' : undefined }}>
                              {gm.arrow} {gm.label}
                            </span>
                          </div>
                          <div className="lh-muted" style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>
                            {sk.count} appearances · {sk.firstHalf} → {sk.secondHalf}
                            {sk.growthPct != null ? ` (${sk.growthPct}%)` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 4. Popular Categories ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Popular Categories</h2>
              <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Categories with the most active listings right now.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                {topCategories.length ? (
                  topCategories.map(cat => (
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

            {/* ── 5. Budget & Rate Direction ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Budget Trend (USD)</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 10px' }}>Average daily budget of USD-listed jobs (fixed = ceiling, hourly = rate). Non-USD listings excluded.</p>
                <div style={s.chartWrap}>
                  <BudgetTrendChart data={intel.budgetTrend.map(d => ({ label: d.label, avgUsd: d.avgUsd }))} />
                </div>
              </div>

              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Fixed vs Hourly</h2>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>How listings are priced, from real budget data.</p>
                <SplitBars
                  total={intel.engagementSplit.fixed + intel.engagementSplit.hourly}
                  items={[
                    { label: 'Fixed Price', value: intel.engagementSplit.fixed, pct: intel.engagementSplit.fixedPct, color: '#2563eb' },
                    { label: 'Hourly Rate', value: intel.engagementSplit.hourly, pct: intel.engagementSplit.hourlyPct, color: '#16a34a' },
                    { label: 'Not specified', value: intel.engagementSplit.unknown, pct: intel.engagementSplit.unknownPct, color: '#94a3b8' },
                  ]}
                />
              </div>
            </div>

            {/* ── 6. Best Hours to Monitor ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Best Hours to Monitor (UTC)</h2>
              <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>When new listings appear most — check platforms around these times.</p>
              {topMonitorHours.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {topMonitorHours.map(h => (
                    <div key={h.hour} style={s.monitorRow} className="lh-surface">
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#f59e0b', minWidth: 58 }}>{h.label.replace(' UTC', '')}</span>
                      <span className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280' }}>{h.count} listings posted</span>
                      <div style={{ flex: 1, marginLeft: 8 }}>
                        <div style={s.barTrack}>
                          <div style={{ ...s.barFill, width: `${Math.round(h.count / Math.max(...topMonitorHours.map(t => t.count), 1) * 100)}%`, background: '#f59e0b' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── 7. 21-Day History (if available) ── */}
            {history && (
              <div className="fade-up lh-surface" style={s.card}>
                <div style={s.cardHead}>
                  <h2 style={s.cardTitle}>21-Day History</h2>
                  <span style={{ ...s.dirChip, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    {historyTotal} listings · 21 days
                  </span>
                </div>
                <div style={s.chartWrap}>
                  <HistoryChart data={historyChart} />
                </div>
                <div style={s.legend}>
                  <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#14a800' }} />Listings per day</span>
                  <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#f59e0b' }} />Avg proposals / listing</span>
                  {history.avgProposalsOverall != null && (
                    <span className="lh-muted" style={s.legendNote}>Window avg: {history.avgProposalsOverall} proposals/listing</span>
                  )}
                </div>

                {/* Interpretation chips */}
                <div style={s.histInsightRow}>
                  {history.weekdaySplit.length > 0 && (
                    <div style={s.histInsight} className="lh-surface">
                      <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Busiest days</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {history.weekdaySplit.slice(0, 3).map(d => (
                          <span key={d.day} style={s.hourChip} className="lh-field">{d.day} · {d.count}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {history.topSkills.length > 0 && (
                    <div style={s.histInsight} className="lh-surface">
                      <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Top skills (window)</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {history.topSkills.slice(0, 4).map(sk => (
                          <span key={sk.skill} style={s.hourChip} className="lh-field">{sk.skill} · {sk.count}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {history.peakHours.length > 0 && (
                    <div style={s.histInsight} className="lh-surface">
                      <div className="lh-muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 }}>Top posting hour</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span style={s.hourChip} className="lh-field">{history.peakHours[0].hour % 12 === 0 ? 12 : history.peakHours[0].hour % 12}{history.peakHours[0].hour < 12 ? ' AM' : ' PM'} UTC · {history.peakHours[0].count} listings</span>
                      </div>
                    </div>
                  )}
                </div>
                <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.6, marginTop: 12 }}>{history.note}</p>
              </div>
            )}

            {/* ── 8. What This Means for You ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>What This Means for You</h2>
              <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 14px' }}>Actionable takeaways based on the current market data.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={s.actionItem}>
                  <span style={{ fontWeight: 700, color: '#16a34a' }}>✓ Focus on growing skills: </span>
                  <span className="lh-body">{growingSkills.length ? growingSkills.slice(0, 3).map(s => s.skill).join(', ') : 'Data still accumulating — check back soon.'}</span>
                </div>
                <div style={s.actionItem}>
                  <span style={{ fontWeight: 700, color: '#b91c1c' }}>✗ Avoid over-investing in: </span>
                  <span className="lh-body">{decliningSkills.length ? decliningSkills.slice(0, 3).map(s => s.skill).join(', ') : 'No clear declining signals yet.'}</span>
                </div>
                <div style={s.actionItem}>
                  <span style={{ fontWeight: 700, color: '#2563eb' }}>🕐 Best times to apply: </span>
                  <span className="lh-body">{topMonitorHours.map(h => h.label.replace(' UTC', '')).join(', ') || 'Check back after more data.'}</span>
                </div>
                <div style={s.actionItem}>
                  <span style={{ fontWeight: 700, color: '#f59e0b' }}>💰 Budget outlook: </span>
                  <span className="lh-body">{(intel.budgetTrend.length >= 2 && (() => {
                    const recent = intel.budgetTrend.slice(-3).filter(d => d.avgUsd != null);
                    const older = intel.budgetTrend.slice(-7, -3).filter(d => d.avgUsd != null);
                    if (recent.length && older.length) {
                      const recentAvg = recent.reduce((a, b) => a + (b.avgUsd ?? 0), 0) / recent.length;
                      const olderAvg = older.reduce((a, b) => a + (b.avgUsd ?? 0), 0) / older.length;
                      const pct = ((recentAvg - olderAvg) / olderAvg * 100).toFixed(0);
                      return pct.startsWith('-') ? 'Budgets trending down — price competitively.' : pct.startsWith('0') ? 'Budgets stable.' : 'Budgets trending up — room for higher rates.';
                    }
                  })()) || 'Insufficient data.'}</span>
                </div>
                <div style={s.actionItem}>
                  <span style={{ fontWeight: 700, color: '#7c3aed' }}>🎯 Target categories: </span>
                  <span className="lh-body">{topCategories.slice(0, 3).map(c => c.category).join(', ') || 'Data still accumulating.'}</span>
                </div>
              </div>
            </div>

            {/* ── 9. Skills to Learn Next ── */}
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

            {/* ── 10. AI Market Insights ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>AI Market Insights</h2>
              <p className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280', margin: '4px 0 12px' }}>
                AI-written reading of the intelligence above. The underlying numbers are the real figures displayed on this page.
              </p>
              {data.marketSummary && <p className="lh-body" style={{ ...s.bodyText, marginBottom: 14 }}>{data.marketSummary}</p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 10 }}>
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

            {/* ── Jobs Posted per Day (compact) ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <div style={s.cardHead}>
                <h2 style={s.cardTitle}>Jobs Posted per Day (7d)</h2>
              </div>
              <div style={s.chartWrap}>
                <JobsPerDayChart data={dailyChart} />
              </div>
              <div style={s.legend}>
                <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#14a800' }} />Upwork</span>
                <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#29b2fe' }} />Freelancer</span>
              </div>
            </div>

          </div>
        ) : (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#dc2626', fontWeight: 600, margin: '0 0 12px' }}>No job data available yet. Intelligence appears after the next sync.</p>
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
  shell: { maxWidth: 980, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' },
  brand: { fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 },
  slogan: { fontSize: 11, color: '#16a34a', fontWeight: 600, marginTop: 1 },
  backBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' },
  pageHead: { marginBottom: 24 },
  pageTitle: { fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#6b7280', lineHeight: 1.65, margin: '0 0 12px', maxWidth: 720 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 32, textAlign: 'center', border: '1px solid #fecaca' },

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(180px,100%),1fr))', gap: 14 },
  heroCard: { background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #e5e7eb' },
  heroLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },
  heroValue: { fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 },
  heroUnit: { fontSize: 13, fontWeight: 600, color: '#9ca3af' },
  heroSub: { fontSize: 12, color: '#6b7280' },

  dirChip: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, display: 'inline-block' },

  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  cardSub: { fontSize: 12.5, color: '#6b7280', margin: '4px 0 0', maxWidth: 560, lineHeight: 1.55 },
  chartWrap: { marginTop: 8 },
  legend: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, color: '#374151', fontWeight: 600 },
  legendDot: { width: 9, height: 9, borderRadius: 3, display: 'inline-block' },
  legendNote: { fontSize: 11.5, color: '#9ca3af' },

  bodyText: { fontSize: 14, color: '#374151', lineHeight: 1.75, margin: '10px 0 0' },

  actionCard: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 0 },

  catRow: { display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f9fafb' },
  countBadge: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  insightCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px' },
  learnCard: { borderRadius: 8, padding: '14px 16px' },
  urgencyTag: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4 },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },

  growthRow: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center' },
  growthTag: { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999 },

  monitorRow: { display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '9px 12px' },
  hourChip: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  histInsightRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 10, marginTop: 14 },
  histInsight: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px' },

  actionItem: { display: 'flex', gap: 10, padding: '10px 12px', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, alignItems: 'flex-start' },

  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
