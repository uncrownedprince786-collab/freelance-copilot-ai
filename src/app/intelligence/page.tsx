'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import SiteNav from '@/components/SiteNav';
import { formatTime12 } from '@/lib/format';

interface Opportunity {
  id: string;
  title: string;
  platform: string;
  budget: string;
  score: number;
  proposalCount: number | null;
  postedAt: string;
  actFast: boolean;
  repeatClient: boolean;
  repeatClientCount: number;
  reason: string;
}

interface SkillItem {
  skill: string;
  count: number;
  growthPct: number | null;
  status: string;
}

interface IntelligenceData {
  generatedAt: string;
  overview: {
    jobsPerDay7: number;
    jobsPerDay30: number;
    marketDirection: string;
    marketDirectionPct: number | null;
    marketDirectionReason: string;
    totalJobs: number;
  };
  changing: {
    growingSkills: SkillItem[];
    decliningSkills: SkillItem[];
    competitionDirection: string;
    competitionReason: string;
    budgetDirection: string;
  };
  opportunities: Opportunity[];
  competition: {
    level: 'Low' | 'Normal' | 'High' | 'Insufficient';
    avgProposals: number | null;
    direction: string;
    reason: string;
  };
  timing: {
    peakHours: { hour: number; label: string; count: number }[];
    topMonitorHours: { hour: number; label: string; count: number }[];
    bestDays: { day: string; count: number }[];
    platformPeakHours: { platform: string; hours: { hour: number; label: string; count: number }[] }[];
    note: string;
  };
  skills: {
    growing: SkillItem[];
    stable: SkillItem[];
    cooling: SkillItem[];
  };
  budgets: {
    trend: { date: string; label: string; avgUsd: number | null; jobs: number }[];
    engagementSplit: { fixed: number; hourly: number; unknown: number; fixedPct: number; hourlyPct: number; unknownPct: number };
    budgetBySkill: { skill: string; avgBudget: number | null; count: number }[];
  };
  clientSignals: {
    repeatClients: number;
    activeBuyers: { clientKey: string; count: number; totalSpend?: string }[];
    platformDifferences: { platform: string; avgScore: number; avgProposals: number | null }[];
  };
  mostActiveSkills: { skill: string; count: number }[];
  browseJobsUrl: string;
}

const DIRECTION_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  rising:      { label: 'Rising',        color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  falling:     { label: 'Falling',       color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  stable:      { label: 'Stable',        color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  insufficient:{ label: 'Too early to tell', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
};

const GROWTH_META: Record<string, { label: string; color: string; arrow: string }> = {
  growing:   { label: 'Growing',   color: '#15803d', arrow: '↗' },
  new:       { label: 'New',       color: '#2563eb', arrow: '↑' },
  declining: { label: 'Declining', color: '#b91c1c', arrow: '↘' },
  stable:    { label: 'Steady',    color: '#6b7280', arrow: '→' },
};

const COMP_LEVEL_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  Low:          { label: 'Low competition',    color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  Normal:       { label: 'Normal competition', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  High:         { label: 'High competition',   color: '#b91c1c', bg: '#fef2f2', border: '#fecaca' },
  Insufficient: { label: 'Too early to tell',  color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
};

function fmt(n: number): string {
  return String(Math.round(n));
}

function usd(n: number | null): string {
  if (n == null) return '—';
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`;
}

export default function IntelligencePage() {
  const router = useRouter();
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { fetchIntelligence(); }, []);

  const fetchIntelligence = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/intelligence');
      if (!res.ok) throw new Error('Failed to load market intelligence');
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load market intelligence');
    } finally {
      setLoading(false);
    }
  };

  const dirMeta = DIRECTION_META[data?.overview.marketDirection ?? 'insufficient'] ?? DIRECTION_META.insufficient;
  const compMeta = data ? COMP_LEVEL_META[data.competition.level] ?? COMP_LEVEL_META.Normal : COMP_LEVEL_META.Normal;
  const maxHourCount = data ? Math.max(...data.timing.topMonitorHours.map(h => h.count), 1) : 1;
  const maxPeakCount = data ? Math.max(...data.timing.peakHours.map(h => h.count), 1) : 1;
  const budgetValues = (data?.budgets.trend ?? []).map(d => d.avgUsd).filter((v): v is number => v != null);
  const maxBudget = budgetValues.length ? Math.max(...budgetValues) : 1;

  const renderSkillList = (items: SkillItem[], empty: string) => (
    items.length ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(sk => {
          const gm = GROWTH_META[sk.status as keyof typeof GROWTH_META] ?? GROWTH_META.stable;
          return (
            <div key={sk.skill} style={{ ...s.growthRow, borderLeft: `3px solid ${gm.color}` }} className="lh-surface">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="lh-h" style={{ fontSize: 13, fontWeight: 700 }}>{sk.skill}</span>
                  {sk.growthPct != null && (
                    <span style={{ ...s.growthTag, color: gm.color, background: gm.color === '#6b7280' ? '#f3f4f6' : undefined }}>
                      {gm.arrow} {sk.growthPct >= 0 ? '+' : ''}{sk.growthPct}%
                    </span>
                  )}
                </div>
                <div className="lh-muted" style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>{sk.count} appearances</div>
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <p className="lh-muted" style={s.emptyNote}>{empty}</p>
    )
  );

  return (
    <div style={s.page} className="lh-page">
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
        .fade-up { animation: fadeUp 0.35s ease both; }
      `}</style>

      <div style={s.shell}>

        <SiteNav />

        {/* Page heading */}
        <div style={s.pageHead}>
          <h1 style={s.pageTitle}>Market Intelligence</h1>
          <p className="lh-body" style={s.pageDesc}>
            A live read of the freelance market from the listings we collect on Upwork and Freelancer — competition, skill demand, budgets, and the best times to strike.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill} className="lh-field">{data.overview.totalJobs} jobs analyzed</span>
              <span style={s.metaPill} className="lh-field">Updated {formatTime12(data.generatedAt)}</span>
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
            <button onClick={fetchIntelligence} style={s.backBtn} className="lh-field">Retry</button>
          </div>
        ) : data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── 1. Overview / Hero stats ── */}
            <div className="fade-up" style={s.heroGrid}>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Jobs / Day (7d)</div>
                <div className="lh-h" style={s.heroValue}>{fmt(data.overview.jobsPerDay7)}</div>
                <div className="lh-muted" style={s.heroSub}>30d: {fmt(data.overview.jobsPerDay30)}/day</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Market Direction</div>
                <div style={{ ...s.heroValue, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 18 }}>
                  <span style={{ ...s.dirChip, color: dirMeta.color, background: dirMeta.bg, border: `1px solid ${dirMeta.border}` }}>{dirMeta.label}</span>
                  {data.overview.marketDirectionPct != null && (
                    <span style={{ fontSize: 13, color: dirMeta.color, fontWeight: 700 }}>{data.overview.marketDirectionPct >= 0 ? '+' : ''}{data.overview.marketDirectionPct}%</span>
                  )}
                </div>
                <div className="lh-muted" style={s.heroSub}>{data.overview.marketDirectionReason}</div>
              </div>
              <div style={s.heroCard} className="lh-surface">
                <div className="lh-muted" style={s.heroLabel}>Competition</div>
                <div style={{ ...s.heroValue, fontSize: 18 }}>
                  <span style={{ ...s.dirChip, color: compMeta.color, background: compMeta.bg, border: `1px solid ${compMeta.border}` }}>{compMeta.label}</span>
                </div>
                <div className="lh-muted" style={s.heroSub}>
                  {data.competition.avgProposals != null ? `Avg ${data.competition.avgProposals} proposals/listing` : 'No proposal data yet'}
                </div>
              </div>
            </div>

            {/* ── 2. Opportunities worth watching ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <div style={s.cardHead}>
                <h2 style={s.cardTitle}>Opportunities Worth Watching</h2>
                <span style={{ ...s.dirChip, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                  {data.opportunities.length} right now
                </span>
              </div>
              <p className="lh-muted" style={s.cardSub}>Fresh, high-match listings from the last sync. These are the ones to bid on while competition is still low.</p>
              {data.opportunities.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(280px,100%),1fr))', gap: 10, marginTop: 14 }}>
                  {data.opportunities.map(op => (
                    <div key={op.id} style={s.oppCard} className="lh-surface">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ ...s.scoreChip, background: op.score >= 80 ? '#f0fdf4' : op.score >= 70 ? '#fffbeb' : '#f3f4f6', color: op.score >= 80 ? '#15803d' : op.score >= 70 ? '#b45309' : '#374151', border: `1px solid ${op.score >= 80 ? '#bbf7d0' : op.score >= 70 ? '#fde68a' : '#e5e7eb'}` }}>
                          {op.score} match
                        </span>
                        {op.actFast && <span style={{ ...s.actFastTag }}>Act fast</span>}
                      </div>
                      <div className="lh-h" style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', margin: '8px 0 4px', lineHeight: 1.45 }}>{op.title}</div>
                      <div className="lh-muted" style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                        {op.platform} · {op.budget || 'Budget N/A'}
                        {op.proposalCount != null ? ` · ${op.proposalCount} proposals` : ''}
                      </div>
                      <div className="lh-body" style={{ fontSize: 12.5, color: '#374151', lineHeight: 1.5 }}>{op.reason}</div>
                      <button
                        onClick={() => router.push(data.browseJobsUrl)}
                        style={s.oppBtn}
                        className="lh-field"
                      >View jobs →</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="lh-muted" style={s.emptyNote}>No standout opportunities in the latest sync — check back after the next run.</p>
              )}
            </div>

            {/* ── 3. What's changing ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>What&apos;s Changing</h2>
              <p className="lh-muted" style={s.cardSub}>Direction of the market over the last week of collected listings.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(250px,100%),1fr))', gap: 12, marginTop: 14 }}>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Competition</div>
                  <div className="lh-h" style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    {DIRECTION_META[data.changing.competitionDirection]?.label ?? 'Too early to tell'}
                  </div>
                  <div className="lh-muted" style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.55 }}>{data.changing.competitionReason}</div>
                </div>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Budgets</div>
                  <div className="lh-body" style={{ fontSize: 13, lineHeight: 1.6 }}>{data.changing.budgetDirection}</div>
                </div>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Growing skills</div>
                  <div className="lh-body" style={{ fontSize: 13, lineHeight: 1.6 }}>
                    {data.changing.growingSkills.length ? data.changing.growingSkills.slice(0, 4).map(s => s.skill).join(', ') : 'Too little signal yet'}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 4. Best times to post/monitor ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Best Times to Monitor (UTC)</h2>
              <p className="lh-muted" style={s.cardSub}>When new listings appear most often in the last 7 days. {data.timing.note}</p>
              {data.timing.topMonitorHours.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  {data.timing.topMonitorHours.map(h => (
                    <div key={h.hour} style={s.monitorRow} className="lh-surface">
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#f59e0b', minWidth: 64 }}>{h.label.replace(' UTC', '')}</span>
                      <span className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280' }}>{h.count} posted</span>
                      <div style={{ flex: 1, marginLeft: 8 }}>
                        <div style={s.barTrack}>
                          <div style={{ ...s.barFill, width: `${Math.round(h.count / maxHourCount * 100)}%`, background: '#f59e0b' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {data.timing.peakHours.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="lh-muted" style={s.changeLabel}>Full 24h picture</div>
                  <div style={s.hourBars}>
                    {data.timing.peakHours.map(h => (
                      <div key={h.hour} style={s.hourBarCol}>
                        <div style={{ ...s.hourBarFill, height: `${Math.max(4, Math.round(h.count / maxPeakCount * 100))}%`, background: h.count === data.timing.topMonitorHours[0]?.count ? '#f59e0b' : '#cbd5e1' }} />
                        <div style={{ fontSize: 9, color: '#9ca3af', transform: 'rotate(-45deg)', marginTop: 2, whiteSpace: 'nowrap' }}>{h.hour}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.timing.bestDays.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                  <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>Busiest days:</span>
                  {data.timing.bestDays.slice(0, 3).map(d => (
                    <span key={d.day} style={s.hourChip} className="lh-field">{d.day} · {d.count}</span>
                  ))}
                </div>
              )}
              {data.timing.platformPeakHours.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {data.timing.platformPeakHours.map(p => (
                    <span key={p.platform} style={s.hourChip} className="lh-field">
                      {p.platform}: {p.hours.map(h => h.label.replace(' UTC', '')).join(', ')}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── 5. Skill demand: growing / steady / cooling ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px,100%),1fr))', gap: 20 }}>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Skills Gaining Demand</h2>
                <p className="lh-muted" style={s.cardSub}>Appearing more in newer listings than older ones.</p>
                <div style={{ marginTop: 12 }}>{renderSkillList(data.skills.growing, 'No clear gainers yet — data is still accumulating.')}</div>
              </div>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Steady Skills</h2>
                <p className="lh-muted" style={s.cardSub}>Consistent demand week over week.</p>
                <div style={{ marginTop: 12 }}>{renderSkillList(data.skills.stable, 'No steady skills to report yet.')}</div>
              </div>
              <div className="fade-up lh-surface" style={s.card}>
                <h2 style={s.cardTitle}>Cooling Skills</h2>
                <p className="lh-muted" style={s.cardSub}>Demand easing in the newer half of the window.</p>
                <div style={{ marginTop: 12 }}>{renderSkillList(data.skills.cooling, 'Nothing cooling down right now.')}</div>
              </div>
            </div>

            {/* ── 6. Budgets ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Budgets & Pricing</h2>
              <p className="lh-muted" style={s.cardSub}>USD-listed jobs only — fixed-price shows the ceiling, hourly shows the rate.</p>
              {data.budgets.trend.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={s.budgetBars}>
                    {data.budgets.trend.map(d => (
                      <div key={d.date} style={s.budgetCol}>
                        <div className="lh-muted" style={{ fontSize: 10.5, color: '#6b7280', marginBottom: 4 }}>
                          {d.avgUsd != null ? usd(d.avgUsd) : '—'}
                        </div>
                        <div style={{ ...s.budgetBar, width: `${Math.max(4, Math.round((d.avgUsd ?? 0) / maxBudget * 100))}%`, background: d.avgUsd == null ? '#e5e7eb' : '#2563eb' }} />
                        <div className="lh-muted" style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{d.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.budgets.budgetBySkill.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 16 }}>
                  {data.budgets.budgetBySkill.map(sk => (
                    <span key={sk.skill} style={s.hourChip} className="lh-field">
                      {sk.skill}: ~{usd(sk.avgBudget)} avg
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <span style={s.engChip} className="lh-field">Fixed {data.budgets.engagementSplit.fixedPct}%</span>
                <span style={s.engChip} className="lh-field">Hourly {data.budgets.engagementSplit.hourlyPct}%</span>
                <span style={s.engChip} className="lh-field">Not specified {data.budgets.engagementSplit.unknownPct}%</span>
              </div>
            </div>

            {/* ── 7. Client signals ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Client Signals</h2>
              <p className="lh-muted" style={s.cardSub}>Signals from actual client behavior in our collected listings.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(220px,100%),1fr))', gap: 12, marginTop: 14 }}>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Repeat clients</div>
                  <div className="lh-h" style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 4 }}>{data.clientSignals.repeatClients}</div>
                  <div className="lh-muted" style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.55 }}>Listings from clients we&apos;ve seen before — usually worth a follow-up.</div>
                </div>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Active buyers</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
                    {data.clientSignals.activeBuyers.length ? (
                      data.clientSignals.activeBuyers.map(b => (
                        <div key={b.clientKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                          <span className="lh-body" style={{ color: '#374151' }}>{b.clientKey}</span>
                          <span className="lh-h" style={{ fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>{b.count} jobs{b.totalSpend ? ` · ${b.totalSpend}` : ''}</span>
                        </div>
                      ))
                    ) : (
                      <span className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280' }}>No multi-posting buyers yet.</span>
                    )}
                  </div>
                </div>
                <div style={s.changeBox} className="lh-surface">
                  <div className="lh-muted" style={s.changeLabel}>Platform differences</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {data.clientSignals.platformDifferences.map(p => (
                      <div key={p.platform} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                        <span className="lh-body" style={{ color: '#374151' }}>{p.platform}</span>
                        <span className="lh-h" style={{ fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' }}>
                          {p.avgScore} avg match{p.avgProposals != null ? ` · ${p.avgProposals} props` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 8. Top active skills ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Most Active Skills</h2>
              <p className="lh-muted" style={s.cardSub}>Most frequently requested across all collected listings.</p>
              {data.mostActiveSkills && data.mostActiveSkills.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {data.mostActiveSkills.slice(0, 12).map(sk => (
                    <span key={sk.skill} style={s.skillChip} className="lh-field">
                      {sk.skill} · {sk.count}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="lh-muted" style={s.emptyNote}>Not enough data yet to rank skills by activity.</p>
              )}
            </div>

            {/* ── 9. CTA ── */}
            <div className="fade-up lh-surface" style={s.card}>
              <h2 style={s.cardTitle}>Ready to Act on This?</h2>
              <p className="lh-muted" style={s.cardSub}>Jump back to the dashboard and hit the freshest opportunities while they&apos;re still cheap to bid on.</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button onClick={() => router.push(data.browseJobsUrl)} style={s.ctaBtn}>Browse live jobs →</button>
                <button onClick={() => router.push('/trading')} style={s.backBtn} className="lh-field">Trends & history</button>
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
  page: { minHeight: '100vh', background: '#f7f9fc',     padding: '24px 16px', color: '#111827' },
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

  heroGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(200px,100%),1fr))', gap: 14 },
  heroCard: { background: '#fff', borderRadius: 10, padding: '16px 18px', border: '1px solid #e5e7eb' },
  heroLabel: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },
  heroValue: { fontSize: 24, fontWeight: 800, color: '#111827', marginBottom: 4 },
  heroSub: { fontSize: 12, color: '#6b7280', lineHeight: 1.5 },

  dirChip: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, display: 'inline-block' },
  scoreChip: { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap' },
  actFastTag: { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', whiteSpace: 'nowrap' },

  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  cardSub: { fontSize: 12.5, color: '#6b7280', margin: '4px 0 0', maxWidth: 640, lineHeight: 1.55 },

  oppCard: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column' },
  oppBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#2563eb', cursor: 'pointer', alignSelf: 'flex-start', marginTop: 10 },

  changeBox: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '12px 14px' },
  changeLabel: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af', marginBottom: 6 },

  growthRow: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center' },
  growthTag: { fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999 },

  monitorRow: { display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '9px 12px' },
  barTrack: { background: '#eef1f5', borderRadius: 4, height: 8, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  hourBars: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, marginTop: 8 },
  hourBarCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', minWidth: 0 },
  hourBarFill: { width: '100%', borderRadius: '3px 3px 0 0', minHeight: 4 },

  budgetBars: { display: 'flex', flexDirection: 'column', gap: 6 },
  budgetCol: { display: 'flex', flexDirection: 'column', gap: 2 },
  budgetBar: { height: 8, borderRadius: 4 },

  hourChip: { fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  engChip: { fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  skillChip: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999 },

  ctaBtn: { background: '#16a34a', border: 'none', borderRadius: 6, padding: '10px 16px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '6px 0' },

  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
