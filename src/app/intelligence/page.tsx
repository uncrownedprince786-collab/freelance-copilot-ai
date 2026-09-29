'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import SiteNav from '@/components/SiteNav';
import { formatDateTime12 } from '@/lib/format';

/* ------------------------------------------------------------------ *
 * Shapes mirror GET /api/trends?report=trend. Declared locally, as the
 * other pages in this app do, so the client bundle carries no server
 * imports.
 * ------------------------------------------------------------------ */

type TrendVerdict =
  | 'insufficient_sample'
  | 'not_measurable'
  | 'confounded'
  | 'inside_threshold'
  | 'unconfirmed'
  | 'up'
  | 'down';

type TrendConfidence = 'none' | 'low' | 'moderate' | 'high';

interface TrendSide {
  value: number | null;
  n: number;
}

interface Trend {
  id: string;
  metric: string;
  unit: 'count' | 'perDay' | 'percent' | 'usd' | 'proposals';
  represents: string;
  comparison: string;
  threshold: string;
  minSample: number;
  current: TrendSide;
  previous: TrendSide;
  changePct: number | null;
  changeAbs: number | null;
  verdict: TrendVerdict;
  confidence: TrendConfidence;
  confidenceBasis: string;
  caveat: string;
}

interface SkillScan {
  keywordsTested: number;
  listingsCurrent: number;
  listingsPrevious: number;
  minOccurrences: number;
  correctedAlpha: number;
  ran: boolean;
  reason: string;
  movers: { skill: string; currentPct: number; previousPct: number; changePp: number; p: number }[];
}

interface HourBand {
  hour: number;
  label: string;
  count: number;
  perDay: number;
  aboveAverage: boolean;
}

interface InventorySnapshot {
  totalRows: number;
  postedAtMissing: number;
  oldestPostedAt: string | null;
  newestPostedAt: string | null;
  platform: { key: string; count: number }[];
  freshness: { key: string; count: number }[];
  staleOrExpired: number;
  staleOrExpiredPct: number;
  leadBand: { key: string; count: number }[];
  leadScoredRows: number;
  authenticity: { key: string; count: number }[];
  duplicate: { key: string; count: number }[];
  clusteredRows: number;
}

interface TrendReport {
  generatedAt: string;
  cached: boolean;
  method: {
    lagGuardHours: number;
    windowHours: number;
    retentionDays: number;
    currentPeriod: { from: string; to: string };
    previousPeriod: { from: string; to: string };
  };
  trends: Trend[];
  skillScan: SkillScan;
  hours: { total: number; days: number; bands: HourBand[]; note: string };
  inventory: InventorySnapshot;
}

/* ------------------------------------------------------------------ */

const VERDICT_META: Record<TrendVerdict, { label: string; color: string; bg: string; border: string }> = {
  // Blue means "measured", not "good". Direction is shown separately and
  // deliberately carries no colour: a rise in competition and a rise in
  // budgets are not the same news.
  up: { label: 'Movement measured', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  down: { label: 'Movement measured', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  inside_threshold: { label: 'No change beyond threshold', color: '#374151', bg: '#f3f4f6', border: '#e5e7eb' },
  confounded: { label: 'Measured, not attributable', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  unconfirmed: { label: 'Not separable from noise', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  insufficient_sample: { label: 'Sample too small', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
  not_measurable: { label: 'Not measurable', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' },
};

const CONFIDENCE_LABEL: Record<TrendConfidence, string> = {
  high: 'High (p < 0.01)',
  moderate: 'Moderate (p < 0.05)',
  low: 'Low (p < 0.10)',
  none: 'None',
};

const FRESHNESS_LABEL: Record<string, string> = {
  just_posted: 'Just posted (<1h)',
  fresh: 'Fresh (1–6h)',
  active: 'Active (6–24h)',
  aging: 'Aging (1–3d)',
  stale: 'Stale (3–7d)',
  expired: 'Expired (>7d)',
  unknown: 'No posting time',
};

const LEAD_BAND_LABEL: Record<string, string> = {
  high: 'High (75–95)',
  promising: 'Promising (60–74)',
  moderate: 'Moderate (40–59)',
  low: 'Low (11–39)',
  insufficient_data: 'Insufficient data',
  not_scored: 'Not yet scored',
};

const DUPLICATE_LABEL: Record<string, string> = {
  independent: 'Independent',
  canonical: 'Cluster representative',
  duplicate: 'Duplicate',
  possible_duplicate: 'Possible duplicate (kept visible)',
  unknown: 'Not yet clustered',
};

const AUTH_LABEL: Record<string, string> = {
  verified: 'Verified',
  supported: 'Supported',
  uncertain: 'Uncertain',
  suspicious: 'Suspicious',
  stale: 'Stale',
  rejected: 'Rejected',
};

function groupInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatValue(value: number | null, unit: Trend['unit']): string {
  if (value == null) return '—';
  switch (unit) {
    case 'perDay':
      return `${value}/day`;
    case 'percent':
      return `${value}%`;
    case 'usd':
      return `$${groupInt(value)}`;
    case 'proposals':
      return `${value}`;
    default:
      return groupInt(value);
  }
}

function utcRange(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return '—';
  const fmt = (d: Date) =>
    `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
  return `${fmt(f)} → ${fmt(t)} UTC`;
}

export default function IntelligencePage() {
  const [data, setData] = useState<TrendReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/trends?report=trend');
      if (!res.ok) throw new Error(`The trend report could not be computed (HTTP ${res.status}).`);
      const json = (await res.json()) as TrendReport;
      if (!json || !Array.isArray(json.trends)) throw new Error('The trend report came back in an unexpected shape.');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'The trend report could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const maxHour = data ? Math.max(...data.hours.bands.map(b => b.count), 1) : 1;

  return (
    <div style={s.page} className="lh-page">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={s.shell}>
        <SiteNav />

        <header style={s.pageHead}>
          <h1 style={s.pageTitle}>Market Trends</h1>
          <p className="lh-body" style={s.pageDesc}>
            Period-over-period measurements taken over the listings this system collected from Upwork and
            Freelancer. Everything here describes <strong>our sample</strong>: a change on this page can mean the
            market moved, or it can mean our own collection moved. Where the data cannot support a claim, the page
            says so instead of showing a number.
          </p>
          {data && (
            <div style={s.metaRow}>
              <span style={s.metaPill} className="lh-field">
                {utcRange(data.method.previousPeriod.from, data.method.currentPeriod.to)}
              </span>
              <span style={s.metaPill} className="lh-field">
                Computed {formatDateTime12(data.generatedAt)}
                {data.cached ? ' · cached' : ''}
              </span>
              <span style={s.metaPill} className="lh-field">{groupInt(data.inventory.totalRows)} listings in store</span>
            </div>
          )}
        </header>

        {loading ? (
          <div style={s.center}>
            <div style={s.spinner} />
            <p className="lh-muted" style={{ color: '#6b7280', marginTop: 14, fontSize: 14 }}>
              Measuring the two comparison periods…
            </p>
          </div>
        ) : error ? (
          <div style={s.errorBox} className="lh-surface">
            <p style={{ color: '#b91c1c', fontWeight: 600, margin: '0 0 6px', fontSize: 14 }}>{error}</p>
            <p className="lh-muted" style={{ color: '#6b7280', fontSize: 13, margin: '0 0 14px', lineHeight: 1.6 }}>
              No cached figures are shown in place of a failed measurement.
            </p>
            <button onClick={load} style={s.button} className="lh-field">Try again</button>
          </div>
        ) : !data ? (
          <div style={s.errorBox} className="lh-surface">
            <p className="lh-body" style={{ fontSize: 14, margin: 0 }}>No report available.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* 1 — method */}
            <section style={s.card} className="lh-surface">
              <h2 style={s.cardTitle}>What counts as a trend here</h2>
              <p className="lh-muted" style={s.cardSub}>
                A number is published on this page only when every one of the following holds. Where one does not,
                the row reports the gap instead of a claim.
              </p>
              <ol style={s.methodList} className="lh-body">
                <li><strong>A named metric</strong> — stated on every row, with what it is and is not.</li>
                <li><strong>Two explicit periods</strong> — {data.method.windowHours}h against the previous {data.method.windowHours}h.</li>
                <li><strong>A stated threshold</strong> — a change smaller than it is reported as no change.</li>
                <li><strong>A sample size</strong> — the observations behind each period, with a minimum below which nothing is claimed.</li>
                <li><strong>A significance test</strong> — with its statistic shown, and an outcome of &ldquo;cannot tell&rdquo; available.</li>
                <li><strong>No confound with the comparison itself</strong> — a metric that already depends on how old a listing is cannot be compared across two periods that differ only in age. Where that applies, both values are shown and the trend claim is withheld.</li>
              </ol>
              <div style={s.periodGrid}>
                <div style={s.periodBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Current period</div>
                  <div className="lh-h" style={s.periodValue}>{utcRange(data.method.currentPeriod.from, data.method.currentPeriod.to)}</div>
                </div>
                <div style={s.periodBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Previous period</div>
                  <div className="lh-h" style={s.periodValue}>{utcRange(data.method.previousPeriod.from, data.method.previousPeriod.to)}</div>
                </div>
              </div>
              <div style={s.noteBox} className="lh-body">
                <p style={s.noteP}>
                  <strong>Why {data.method.windowHours}h and not 7 days.</strong> Listings are deleted after{' '}
                  {data.method.retentionDays} days, so a week-against-week comparison would need fourteen days of
                  listings that no longer exist. Two {data.method.windowHours}-hour periods plus the lag guard fit
                  inside retention, so neither period has been partly deleted.
                </p>
                <p style={s.noteP}>
                  <strong>Why the last {data.method.lagGuardHours} hours are excluded.</strong> Listings reach this
                  system 1–2 hours after they are posted. The most recent hours are still filling, and comparing them
                  against a settled period would invent a decline every single time.
                </p>
                <p style={s.noteP}>
                  <strong>Direction is not a verdict.</strong> Arrows show which way a measurement moved. Whether that
                  is good news depends on the metric — more listings is not the same kind of news as more proposals
                  per listing.
                </p>
              </div>
            </section>

            {/* 2 — trends */}
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={s.sectionHeading}>Measurements</h2>
              {data.trends.map(t => {
                const vm = VERDICT_META[t.verdict] ?? VERDICT_META.not_measurable;
                const measured = t.verdict === 'up' || t.verdict === 'down';
                const delta = t.unit === 'percent' ? t.changeAbs : t.changePct;
                const deltaText =
                  delta == null
                    ? null
                    : `${delta > 0 ? '+' : ''}${delta}${t.unit === 'percent' ? ' pp' : '%'}`;
                return (
                  <article key={t.id} style={s.card} className="lh-surface">
                    <div style={s.trendHead}>
                      <h3 style={s.trendTitle} className="lh-h">{t.metric}</h3>
                      <span style={{ ...s.chip, color: vm.color, background: vm.bg, border: `1px solid ${vm.border}` }}>
                        {vm.label}
                      </span>
                    </div>

                    <div style={s.valueGrid}>
                      <div style={s.valueBox} className="lh-surface">
                        <div className="lh-muted" style={s.microLabel}>Current {data.method.windowHours}h</div>
                        <div className="lh-h" style={s.valueBig}>{formatValue(t.current.value, t.unit)}</div>
                        <div className="lh-muted" style={s.valueSub}>n = {groupInt(t.current.n)}</div>
                      </div>
                      <div style={s.valueBox} className="lh-surface">
                        <div className="lh-muted" style={s.microLabel}>Previous {data.method.windowHours}h</div>
                        <div className="lh-h" style={s.valueBig}>{formatValue(t.previous.value, t.unit)}</div>
                        <div className="lh-muted" style={s.valueSub}>n = {groupInt(t.previous.n)}</div>
                      </div>
                      <div style={s.valueBox} className="lh-surface">
                        <div className="lh-muted" style={s.microLabel}>Change</div>
                        <div className="lh-h" style={s.valueBig}>
                          {deltaText ? (
                            <>
                              {measured && <span style={{ marginRight: 4 }}>{(delta ?? 0) > 0 ? '↑' : '↓'}</span>}
                              {deltaText}
                            </>
                          ) : (
                            '—'
                          )}
                        </div>
                        <div className="lh-muted" style={s.valueSub}>threshold {t.threshold}</div>
                      </div>
                    </div>

                    <dl style={s.defList}>
                      <div style={s.defRow}>
                        <dt className="lh-muted" style={s.defTerm}>What it measures</dt>
                        <dd className="lh-body" style={s.defDesc}>{t.represents}</dd>
                      </div>
                      <div style={s.defRow}>
                        <dt className="lh-muted" style={s.defTerm}>Comparison</dt>
                        <dd className="lh-body" style={s.defDesc}>
                          {t.comparison}. Minimum sample {t.minSample} per period.
                        </dd>
                      </div>
                      <div style={s.defRow}>
                        <dt className="lh-muted" style={s.defTerm}>Confidence</dt>
                        <dd className="lh-body" style={s.defDesc}>
                          {CONFIDENCE_LABEL[t.confidence]} — {t.confidenceBasis}
                        </dd>
                      </div>
                      <div style={s.defRow}>
                        <dt className="lh-muted" style={s.defTerm}>Caveat</dt>
                        <dd className="lh-body" style={s.defDesc}>{t.caveat}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </section>

            {/* 3 — skill scan */}
            <section style={s.card} className="lh-surface">
              <div style={s.trendHead}>
                <h2 style={s.cardTitle}>Skill demand scan</h2>
                <span
                  style={{
                    ...s.chip,
                    ...(data.skillScan.movers.length
                      ? { color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe' }
                      : { color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb' }),
                  }}
                >
                  {data.skillScan.movers.length} of {data.skillScan.keywordsTested} moved
                </span>
              </div>
              <p className="lh-muted" style={s.cardSub}>
                Each of {data.skillScan.keywordsTested} keywords is tested for a change in the share of listings that
                mention it. Testing that many things at once produces apparent winners by chance alone, so the
                significance level is divided across all of them (α = {data.skillScan.correctedAlpha}). A keyword needs
                at least {data.skillScan.minOccurrences} occurrences across the two periods to be tested at all.
              </p>
              <p className="lh-body" style={{ ...s.noteP, marginTop: 12 }}>{data.skillScan.reason}</p>
              {data.skillScan.movers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {data.skillScan.movers.map(m => (
                    <div key={m.skill} style={s.listRow} className="lh-surface">
                      <span className="lh-h" style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{m.skill}</span>
                      <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>
                        {m.previousPct}% → {m.currentPct}% of listings ({m.changePp > 0 ? '+' : ''}{m.changePp} pp, p = {m.p})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 4 — posting hours */}
            <section style={s.card} className="lh-surface">
              <h2 style={s.cardTitle}>When listings appear (UTC)</h2>
              <p className="lh-muted" style={s.cardSub}>
                The decision this supports: when to check the feed if you want to reach a listing while it is still
                fresh. {data.hours.note}
              </p>
              {data.hours.total === 0 ? (
                <p className="lh-muted" style={s.emptyNote}>No listings with a source posting time in this window.</p>
              ) : (
                <>
                  <div style={s.hourChart}>
                    {data.hours.bands.map(b => (
                      <div key={b.hour} style={s.hourCol} title={`${b.label}: ${b.count} listings (${b.perDay}/day)`}>
                        <div
                          style={{
                            ...s.hourBar,
                            height: `${Math.max(3, Math.round((b.count / maxHour) * 100))}%`,
                            background: b.aboveAverage ? '#1d4ed8' : '#cbd5e1',
                          }}
                        />
                        <div className="lh-muted" style={s.hourTick}>{b.hour}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
                    <span className="lh-muted" style={{ fontSize: 12, color: '#6b7280' }}>Busier than average:</span>
                    {data.hours.bands.filter(b => b.aboveAverage).length === 0 ? (
                      <span className="lh-muted" style={{ fontSize: 12.5, color: '#6b7280' }}>
                        none — posting is spread evenly enough that no hour stands out at this sample size.
                      </span>
                    ) : (
                      data.hours.bands
                        .filter(b => b.aboveAverage)
                        .map(b => (
                          <span key={b.hour} style={s.smallChip} className="lh-field">
                            {b.label} · {b.perDay}/day
                          </span>
                        ))
                    )}
                  </div>
                </>
              )}
            </section>

            {/* 5 — inventory */}
            <section style={s.card} className="lh-surface">
              <div style={s.trendHead}>
                <h2 style={s.cardTitle}>Current inventory</h2>
                <span style={{ ...s.chip, color: '#374151', background: '#f3f4f6', border: '1px solid #e5e7eb' }}>
                  Snapshot, not a trend
                </span>
              </div>
              <p className="lh-muted" style={s.cardSub}>
                What is in the store right now, counted directly. These are single-point counts with no comparison
                period behind them, so nothing here is described as rising or falling.
                {data.inventory.oldestPostedAt && data.inventory.newestPostedAt
                  ? ` Posting times span ${utcRange(data.inventory.oldestPostedAt, data.inventory.newestPostedAt)}.`
                  : ''}
              </p>

              <div style={s.invGrid}>
                <div style={s.invBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Freshness</div>
                  {data.inventory.freshness.map(f => (
                    <div key={f.key} style={s.invRow}>
                      <span className="lh-body" style={s.invKey}>{FRESHNESS_LABEL[f.key] ?? f.key}</span>
                      <span className="lh-h" style={s.invVal}>{groupInt(f.count)}</span>
                    </div>
                  ))}
                  <p className="lh-muted" style={s.invNote}>
                    {data.inventory.staleOrExpiredPct}% of the store ({groupInt(data.inventory.staleOrExpired)} listings)
                    is stale or expired by this system&rsquo;s own thresholds. That is a scheduling problem, and it is
                    reported rather than hidden.
                  </p>
                </div>

                <div style={s.invBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Lead score band</div>
                  {data.inventory.leadBand.map(b => (
                    <div key={b.key} style={s.invRow}>
                      <span className="lh-body" style={s.invKey}>{LEAD_BAND_LABEL[b.key] ?? b.key}</span>
                      <span className="lh-h" style={s.invVal}>{groupInt(b.count)}</span>
                    </div>
                  ))}
                  <p className="lh-muted" style={s.invNote}>
                    {groupInt(data.inventory.leadScoredRows)} of {groupInt(data.inventory.totalRows)} listings have been
                    through the scoring pass. A band is our own judgement, not a source fact.
                  </p>
                </div>

                <div style={s.invBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Duplicate status</div>
                  {data.inventory.duplicate.map(d => (
                    <div key={d.key} style={s.invRow}>
                      <span className="lh-body" style={s.invKey}>{DUPLICATE_LABEL[d.key] ?? d.key}</span>
                      <span className="lh-h" style={s.invVal}>{groupInt(d.count)}</span>
                    </div>
                  ))}
                  <p className="lh-muted" style={s.invNote}>
                    {groupInt(data.inventory.clusteredRows)} of {groupInt(data.inventory.totalRows)} listings have a
                    clustering verdict. Uncertain matches stay in the feed and are linked, never hidden.
                  </p>
                </div>

                <div style={s.invBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Authenticity</div>
                  {data.inventory.authenticity.map(a => (
                    <div key={a.key} style={s.invRow}>
                      <span className="lh-body" style={s.invKey}>{AUTH_LABEL[a.key] ?? a.key}</span>
                      <span className="lh-h" style={s.invVal}>{groupInt(a.count)}</span>
                    </div>
                  ))}
                  <p className="lh-muted" style={s.invNote}>
                    Nothing is ever marked verified: that would require re-fetching the source URL, which this system
                    does not do.
                  </p>
                </div>

                <div style={s.invBox} className="lh-surface">
                  <div className="lh-muted" style={s.microLabel}>Source</div>
                  {data.inventory.platform.map(p => (
                    <div key={p.key} style={s.invRow}>
                      <span className="lh-body" style={s.invKey}>{p.key}</span>
                      <span className="lh-h" style={s.invVal}>{groupInt(p.count)}</span>
                    </div>
                  ))}
                  <p className="lh-muted" style={s.invNote}>
                    Volume is not quality. Upwork supplies far fewer listings and a much higher share of useful leads.
                  </p>
                </div>
              </div>
            </section>

            {/* 6 — deliberate omissions */}
            <section style={s.card} className="lh-surface">
              <h2 style={s.cardTitle}>What this page deliberately does not show</h2>
              <ul style={s.omitList} className="lh-body">
                <li>
                  <strong>Week-over-week anything.</strong> Listings are deleted at {data.method.retentionDays} days.
                  The per-day aggregates that outlive them are rewritten from the live store each sync, so an aged-out
                  day freezes at whatever partial count survived the last purge. They are usable for hour-of-day
                  patterns and not for week-against-week volume.
                </li>
                <li>
                  <strong>Market-wide totals.</strong> This system sees the listings its own queries returned. It has
                  no way to know what share of either marketplace that is.
                </li>
                <li>
                  <strong>Per-skill rankings labelled as demand.</strong> A keyword&rsquo;s rank in one snapshot is not
                  a trend. Keyword movement is tested above, with a correction for how many keywords are tested.
                </li>
                <li>
                  <strong>Live competition.</strong> A proposal count is captured once, shortly after posting, and never
                  refreshed. It is comparable between periods and is not current for any individual listing.
                </li>
                <li>
                  <strong>Written market commentary.</strong> Nothing on this page is generated by a language model.
                </li>
              </ul>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
                <Link href="/" style={s.buttonPrimary}>Open the lead feed</Link>
                <Link href="/about" style={s.button} className="lh-field">How the data is produced</Link>
              </div>
            </section>
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
  page: { minHeight: '100vh', background: '#f7f9fc', padding: '24px 16px', color: '#111827' },
  shell: { maxWidth: 980, margin: '0 auto' },

  pageHead: { marginBottom: 24 },
  pageTitle: { fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 8px', letterSpacing: '-0.02em' },
  pageDesc: { fontSize: 14, color: '#374151', lineHeight: 1.7, margin: '0 0 14px', maxWidth: 720 },
  metaRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  metaPill: { fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 4, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },

  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60 },
  spinner: { width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#fff', borderRadius: 10, padding: 28, border: '1px solid #e5e7eb' },

  sectionHeading: { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '4px 0 0' },

  card: { background: '#fff', borderRadius: 10, padding: '20px 22px', border: '1px solid #e5e7eb' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  cardSub: { fontSize: 12.5, color: '#6b7280', margin: '6px 0 0', maxWidth: 680, lineHeight: 1.65 },

  methodList: { margin: '14px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: '#374151' },

  periodGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 10, marginTop: 14 },
  periodBox: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px' },
  periodValue: { fontSize: 13, fontWeight: 700, color: '#111827', marginTop: 4, lineHeight: 1.5 },

  noteBox: { marginTop: 14, borderTop: '1px solid #eef1f5', paddingTop: 12 },
  noteP: { fontSize: 12.5, color: '#374151', lineHeight: 1.7, margin: '0 0 8px' },

  trendHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
  trendTitle: { fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, letterSpacing: '-0.01em' },
  chip: { fontSize: 11.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' },

  valueGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(140px,100%),1fr))', gap: 10, marginTop: 14 },
  valueBox: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '10px 12px' },
  valueBig: { fontSize: 20, fontWeight: 800, color: '#111827', margin: '4px 0 2px', letterSpacing: '-0.02em' },
  valueSub: { fontSize: 11.5, color: '#6b7280' },

  microLabel: { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af' },

  defList: { margin: '16px 0 0', display: 'flex', flexDirection: 'column', gap: 8 },
  defRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 2 },
  defTerm: { fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af', margin: 0 },
  defDesc: { fontSize: 12.5, color: '#374151', lineHeight: 1.7, margin: 0 },

  listRow: { display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '9px 12px' },

  hourChart: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 110, marginTop: 16 },
  hourCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  hourBar: { width: '100%', borderRadius: '2px 2px 0 0', minHeight: 3 },
  hourTick: { fontSize: 8.5, color: '#9ca3af', marginTop: 3 },

  invGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(250px,100%),1fr))', gap: 12, marginTop: 16 },
  invBox: { background: '#fafafa', border: '1px solid #eef1f5', borderRadius: 8, padding: '12px 14px' },
  invRow: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' },
  invKey: { color: '#374151', minWidth: 0 },
  invVal: { fontWeight: 700, color: '#111827', whiteSpace: 'nowrap' },
  invNote: { fontSize: 11.5, color: '#6b7280', lineHeight: 1.6, margin: '8px 0 0', paddingTop: 8, borderTop: '1px solid #eef1f5' },

  omitList: { margin: '14px 0 0', paddingLeft: 20, fontSize: 12.5, lineHeight: 1.8, color: '#374151' },

  smallChip: { fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  emptyNote: { fontSize: 13, color: '#6b7280', lineHeight: 1.65, margin: '12px 0 0' },

  button: { display: 'inline-block', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', textDecoration: 'none' },
  buttonPrimary: { display: 'inline-block', background: '#2563eb', border: '1px solid #2563eb', borderRadius: 6, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer', textDecoration: 'none' },

  footer: { textAlign: 'center', marginTop: 48, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: 12 },
};
