'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, isAdmin, logout, trackActivity } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { IconTrend, IconShield, IconMapPin } from '@/components/icons';
import { timeAgo } from '@/lib/format';
import { compareOpportunities } from '@/lib/opportunityRanking';

const FILTERS_KEY = 'lh_jobs_filters';

type PlatformScope = 'all' | 'Upwork' | 'Freelancer';
type SortKey = 'recommended' | 'date' | 'competition' | 'budget';
type OpportunityKey = 'all' | 'recommended' | 'actFast';

interface FilterState {
  platform: PlatformScope;
  sortBy: SortKey;
  jobTypeFilter: 'all' | 'fixed' | 'hourly';
  opportunityFilter: OpportunityKey;
  countryFilter: string;
  connectionFilter: string;
  budgetFilter: string;
  searchQuery: string;
}

const DEFAULT_FILTERS: FilterState = {
  platform: 'Upwork',
  sortBy: 'recommended',
  jobTypeFilter: 'all',
  opportunityFilter: 'all',
  countryFilter: 'all',
  connectionFilter: 'all',
  budgetFilter: 'all',
  searchQuery: '',
};

function loadFilters(): FilterState {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    const merged = { ...DEFAULT_FILTERS, ...parsed };
    // "All Platforms" was removed — coerce any stale stored value to a real
    // platform so a returning visitor never lands on the deleted scope.
    if (merged.platform !== 'Upwork' && merged.platform !== 'Freelancer') merged.platform = DEFAULT_FILTERS.platform;
    return merged;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: FilterState) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* quota/non-window */ }
}

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
  isNew?: boolean;
  company?: string;
  location?: string;
  country?: string;
  clientName?: string;
  clientSpend?: string;
  clientReviews?: string;
  connections?: number;
  proposalCount?: number | null;
  category?: string;
  opportunityReason?: string;
  skills?: string[];
  experienceLevel?: string;
  duration?: string;
  clientKey?: string | null;
  repeatClient?: boolean;
  repeatClientCount?: number;
  actFast?: boolean;
}

const PLATFORM_COLORS: Record<string, string> = {
  Upwork: '#14a800',
  Freelancer: '#29b2fe',
  RemoteOK: '#ff6b35',
  'Remote OK': '#ff6b35',
  WeWorkRemotely: '#3b82f6',
  Remotive: '#8b5cf6',
};

function getScoreColor(score: number) {
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

const CATEGORY_COLORS: Record<string, string> = {
  High: '#10b981',
  Good: '#3b82f6',
  Review: '#f59e0b',
  Skip: '#ef4444',
};

// Normalized competition value for ranking: known counts sort ascending;
// missing/unknown proposal data is sent to the very bottom (never treated as 0).
function compValue(j: Job): number {
  const n = j.proposalCount;
  return typeof n === 'number' ? n : Number.POSITIVE_INFINITY;
}
function postedTimeOf(j: Job): number {
  return new Date(j.postedAt || 0).getTime();
}
function budgetNumber(s: string): number {
  const m = s.match(/\$?([\d,]+)/);
  return m ? parseInt(m[1].replace(',', ''), 10) : 0;
}

// A derived, non-hardcoded budget range. Label is also used as the stable key
// for the selected filter, so it must be unique per bucket.
interface BudgetBucket {
  label: string;
  min: number;
  max: number;
  inclusiveMax: boolean;
}

function fmtMoney(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

// Build budget ranges purely from the numeric budgets actually present in the
// current scope (quantile edges), so no threshold is hardcoded and no empty
// bucket is ever produced.
function buildBudgetBuckets(vals: number[]): BudgetBucket[] {
  const v = vals.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return [];
  if (v.length === 1) return [{ label: `$${fmtMoney(v[0])}`, min: v[0], max: v[0], inclusiveMax: true }];
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  const edges = [v[0], q(0.25), q(0.5), q(0.75), v[v.length - 1]];
  const buckets: BudgetBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const last = i === edges.length - 2;
    const members = v.filter(n => n >= lo && (last ? n <= hi : n < hi));
    if (members.length === 0) continue;
    const mn = members[0];
    const mx = members[members.length - 1];
    buckets.push({
      label: mn === mx ? `$${fmtMoney(mn)}` : `$${fmtMoney(mn)}–$${fmtMoney(mx)}`,
      min: lo,
      max: hi,
      inclusiveMax: last,
    });
  }
  return buckets;
}

/**
 * Default "Recommended" ranking — shared with the jobs feed and the AI agent
 * (see src/lib/opportunityRanking.ts). Freshness-first: freshest jobs lead,
 * then within comparable freshness lower known competition, then the existing
 * opportunity signals. A confirmed 0 proposals is a real low-competition
 * signal; unknown proposal counts are NOT treated as 0 and go last.
 */
function recommendedComparator(a: Job, b: Job): number {
  return compareOpportunities(a, b);
}

/**
 * Explicit "Lowest competition" sort — proposals-first on purpose: known counts
 * ascending (unknown last, never treated as 0), then score, then freshness,
 * then the remaining signals. This is the user choosing competition over
 * freshness; the default Recommended ranking stays freshness-first.
 */
function competitionComparator(a: Job, b: Job): number {
  const ca = compValue(a), cb = compValue(b);
  if (ca !== cb) return ca - cb;
  if (b.score !== a.score) return b.score - a.score;
  const ta = postedTimeOf(a), tb = postedTimeOf(b);
  if (tb !== ta) return tb - ta;
  const fa = a.actFast ? 1 : 0, fb = b.actFast ? 1 : 0;
  if (fb !== fa) return fb - fa;
  const ba = budgetNumber(a.budget), bb = budgetNumber(b.budget);
  if (bb !== ba) return bb - ba;
  const ra = a.repeatClient ? 1 : 0, rb = b.repeatClient ? 1 : 0;
  if (rb !== ra) return rb - ra;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Single source of truth for filtering. Applies every active filter to a job.
 * `except` lets the faceted-count pass ignore one dimension so option counts
 * reflect "all other filters applied". Platform scope is applied separately
 * (the platform selector defines the dataset, it is not a facet).
 */
function inBudgetBucket(job: Job, b: BudgetBucket | undefined): boolean {
  if (!b) return false;
  const n = budgetNumber(job.budget);
  return b.inclusiveMax ? n >= b.min && n <= b.max : n >= b.min && n < b.max;
}

/**
 * Simple keyword search over the real job feed. Every whitespace-separated
 * token must appear in the listing's title, description, skills, category,
 * client name, or country (case-insensitive). Multi-word phrases match as a
 * whole. This runs client-side over the already-fetched feed — no extra API,
 * no fabricated results.
 */
function matchesSearchQuery(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${job.title || ''} ${job.description || ''} ${(job.skills || []).join(' ')} ${job.category || ''} ${job.clientName || ''} ${job.country || ''}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

function passes(f: FilterState, job: Job, except?: string, budgetBuckets?: BudgetBucket[]): boolean {
  if (except !== 'search') {
    if (f.searchQuery && !matchesSearchQuery(job, f.searchQuery)) return false;
  }
  if (except !== 'jobType') {
    if (f.jobTypeFilter !== 'all') {
      const bt = (job.budgetType || '').toLowerCase();
      if (f.jobTypeFilter === 'fixed' && !bt.includes('fixed')) return false;
      if (f.jobTypeFilter === 'hourly' && !bt.includes('hourly')) return false;
    }
  }
  if (except !== 'opportunity') {
    if (f.opportunityFilter === 'recommended' && !(job.score >= 70)) return false;
    if (f.opportunityFilter === 'actFast' && !job.actFast) return false;
  }
  if (except !== 'country') {
    if (f.countryFilter !== 'all' && job.country !== f.countryFilter) return false;
  }
  if (except !== 'connection') {
    if (f.connectionFilter !== 'all' && (job.connections ?? 0) !== Number(f.connectionFilter)) return false;
  }
  if (except !== 'budget') {
    if (f.budgetFilter !== 'all') {
      const b = budgetBuckets?.find(x => x.label === f.budgetFilter);
      if (b && !inBudgetBucket(job, b)) return false;
    }
  }
  return true;
}

export default function Home() {
  return (
    <React.Suspense fallback={<div style={styles.splashLoad}>Loading…</div>}>
      <HomeContent />
    </React.Suspense>
  );
}

function HomeContent() {
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [authed, setAuthed] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAuthed(isAuthenticated());
      setAdminMode(isAdmin());
    }
  }, []);

  // Session heartbeat — keeps the session marked active & records presence.
  useEffect(() => {
    if (!authed) return;
    const idle = setInterval(() => trackActivity('heartbeat'), 90_000);
    return () => clearInterval(idle);
  }, [authed]);

  // Filters — restored from per-tab sessionStorage; a fresh session defaults
  // to "all platforms" with the Recommended sort.
  const [platform, setPlatform] = useState<PlatformScope>(() => loadFilters().platform);
  const [sortBy, setSortBy] = useState<SortKey>(() => loadFilters().sortBy || 'recommended');
  const [jobTypeFilter, setJobTypeFilter] = useState<'all' | 'fixed' | 'hourly'>(() => loadFilters().jobTypeFilter);
  const [opportunityFilter, setOpportunityFilter] = useState<OpportunityKey>(() => loadFilters().opportunityFilter);
  const [countryFilter, setCountryFilter] = useState<string>(() => loadFilters().countryFilter || 'all');
  const [connectionFilter, setConnectionFilter] = useState<string>(() => loadFilters().connectionFilter || 'all');
  const [budgetFilter, setBudgetFilter] = useState<string>(() => loadFilters().budgetFilter || 'all');
  const [searchQuery, setSearchQuery] = useState<string>(() => loadFilters().searchQuery || '');
  const [page, setPage] = useState(1);

  // Persist filter state across navigation/refresh (per-tab sessionStorage).
  useEffect(() => {
    saveFilters({ platform, sortBy, jobTypeFilter, opportunityFilter, countryFilter, connectionFilter, budgetFilter, searchQuery });
  }, [platform, sortBy, jobTypeFilter, opportunityFilter, countryFilter, connectionFilter, budgetFilter, searchQuery]);

  const PER_PAGE = 24;

  // Both platforms we support, always offered as selectors even if the current
  // dataset is thin for one of them (so the structure is predictable).
  const PLATFORM_OPTIONS: PlatformScope[] = ['Upwork', 'Freelancer'];

  // Platform scope = the dataset the filters operate on.
  const scopeJobs = useMemo(
    () => (platform === 'all' ? jobs : jobs.filter(j => j.platform === platform)),
    [jobs, platform]
  );

  // Dynamic Country options — only real countries present in the current scope.
  const countryOptions = useMemo(() => {
    const m = new Map<string, number>();
    scopeJobs.forEach(j => { if (j.country) m.set(j.country, (m.get(j.country) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [scopeJobs]);

  // Dynamic Connection options — distinct connects-cost values present in scope.
  const connectionOptions = useMemo(() => {
    const m = new Map<number, number>();
    scopeJobs.forEach(j => {
      const c = j.connections ?? 0;
      if (c > 0) m.set(c, (m.get(c) || 0) + 1);
    });
    return [...m.keys()].sort((a, b) => a - b);
  }, [scopeJobs]);

  // Dynamic Budget ranges — derived from the actual numeric budgets in scope.
  const budgetBuckets = useMemo(
    () => buildBudgetBuckets(scopeJobs.map(j => budgetNumber(j.budget))),
    [scopeJobs]
  );

  const hasFixed = useMemo(() => scopeJobs.some(j => (j.budgetType || '').toLowerCase().includes('fixed')), [scopeJobs]);
  const hasHourly = useMemo(() => scopeJobs.some(j => (j.budgetType || '').toLowerCase().includes('hourly')), [scopeJobs]);

  // Bundle the active filters so the pure filter/count helpers can read them.
  const f = useMemo<FilterState>(
    () => ({ platform, sortBy, jobTypeFilter, opportunityFilter, countryFilter, connectionFilter, budgetFilter, searchQuery }),
    [platform, sortBy, jobTypeFilter, opportunityFilter, countryFilter, connectionFilter, budgetFilter, searchQuery]
  );

  // Stats are always scoped to the current dataset (the selected platform).
  // "new" only counts genuinely-new listings (posted within the last 24 h,
  // as derived by the server feed), never merely-unviewed ones.
  const stats = useMemo(() => ({
    total: scopeJobs.length,
    new: scopeJobs.filter(j => j.isNew).length,
    hot: scopeJobs.filter(j => j.score >= 70).length,
    applied: scopeJobs.filter(j => j.applied).length,
  }), [scopeJobs]);

  // Faceted counts — every option count is recomputed from jobs that match all
  // OTHER active filters, so counts stay honest as the user changes anything.
  const facets = useMemo(() => {
    const countExcept = (except: string, pred: (j: Job) => boolean) =>
      scopeJobs.filter(j => passes(f, j, except, budgetBuckets) && pred(j)).length;

    const opportunity = {
      all: countExcept('opportunity', () => true),
      recommended: countExcept('opportunity', j => j.score >= 70),
      actFast: countExcept('opportunity', j => !!j.actFast),
    };
    const jobType = {
      fixed: hasFixed ? countExcept('jobType', j => (j.budgetType || '').toLowerCase().includes('fixed')) : 0,
      hourly: hasHourly ? countExcept('jobType', j => (j.budgetType || '').toLowerCase().includes('hourly')) : 0,
    };
    const country: Record<string, number> = {};
    countryOptions.forEach(c => { country[c] = countExcept('country', j => j.country === c); });
    const connection: Record<string, number> = {};
    connectionOptions.forEach(c => { connection[String(c)] = countExcept('connection', j => (j.connections ?? 0) === c); });
    const budget: Record<string, number> = {};
    budgetBuckets.forEach(b => { budget[b.label] = countExcept('budget', j => inBudgetBucket(j, b)); });

    return { opportunity, jobType, country, connection, budget };
  }, [scopeJobs, f, countryOptions, connectionOptions, budgetBuckets, hasFixed, hasHourly]);

  const filteredJobs = useMemo(() => {
    const result = scopeJobs.filter(j => passes(f, j, undefined, budgetBuckets));

    if (sortBy === 'recommended') {
      result.sort(recommendedComparator);
    } else if (sortBy === 'competition') {
      result.sort(competitionComparator);
    } else if (sortBy === 'date') result.sort((a, b) => postedTimeOf(b) - postedTimeOf(a));
    else if (sortBy === 'budget') result.sort((a, b) => budgetNumber(b.budget) - budgetNumber(a.budget));

    // Push applied jobs to the bottom so open opportunities lead (stable sort
    // preserves the primary ranking among non-applied jobs).
    result.sort((a, b) => {
      if (a.applied && !b.applied) return 1;
      if (!a.applied && b.applied) return -1;
      return 0;
    });
    return result;
  }, [scopeJobs, f, sortBy, budgetBuckets]);

  const totalPages = Math.ceil(filteredJobs.length / PER_PAGE);
  const paginatedJobs = useMemo(() => filteredJobs.slice((page - 1) * PER_PAGE, page * PER_PAGE), [filteredJobs, page]);

  const goToPage = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/jobs');
      const data: Job[] = await res.json();
      // Guests see NO server-persisted viewed/applied state — both are kept
      // per-tab in sessionStorage so a guest's own history is private to the
      // browsing session.
      const role = typeof window !== 'undefined' ? sessionStorage.getItem('lh_auth_role') : null;
      const isAdminUser = role === 'admin';
      const guestApplied: Set<string> = new Set(
        JSON.parse(typeof window !== 'undefined' ? (sessionStorage.getItem('guest_applied') || '[]') : '[]')
      );
      const guestViewed: Set<string> = new Set(
        JSON.parse(typeof window !== 'undefined' ? (sessionStorage.getItem('guest_viewed') || '[]') : '[]')
      );
      const cleaned = data.map(j => ({
        ...j,
        applied: isAdminUser ? j.applied : guestApplied.has(j.id),
        viewed: isAdminUser ? j.viewed : guestViewed.has(j.id),
      }));
      setPage(1);
      setJobs(cleaned);
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchJobs(); }, [fetchJobs]);

  // Real freshness telemetry — when the last successful sync actually ran and
  // the adaptive cadence derived from real posting activity.
  useEffect(() => {
    fetch('/api/sync/status')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then(d => {
        if (d?.lastSyncedAt) setLastSyncedAt(d.lastSyncedAt);
      })
      .catch(() => { /* freshness is non-critical */ });
  }, []);

  const handleSync = async () => {
    try {
      const res = await fetch('/api/sync?force=true', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json();
      if (!res.ok) return;
      if (data.newJobs > 0) {
        setNewCount(data.newJobs);
        trackActivity('sync', `${data.newJobs} new jobs`);
        await fetchJobs();
      }
    } catch {
      /* ignore */
    }
  };

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingJob, setPendingJob] = useState<Job | null>(null);

  const handleJobClick = (job: Job) => {
    if (!isAuthenticated()) {
      setPendingJob(job);
      setShowAuthModal(true);
      return;
    }
    const role = typeof window !== 'undefined' ? sessionStorage.getItem('lh_auth_role') : null;
    if (role !== 'admin' && typeof window !== 'undefined') {
      try {
        const guestViewed: string[] = JSON.parse(sessionStorage.getItem('guest_viewed') || '[]');
        if (!guestViewed.includes(job.id)) {
          guestViewed.push(job.id);
          sessionStorage.setItem('guest_viewed', JSON.stringify(guestViewed));
        }
      } catch {/* ignore */}
    }
    if (typeof window !== 'undefined') sessionStorage.setItem('selectedJob', JSON.stringify(job));
    trackActivity('view_job', job.title);
    router.push(`/job/${job.id}`);
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    setAuthed(isAuthenticated());
    setAdminMode(isAdmin());
    if (pendingJob) {
      if (typeof window !== 'undefined') sessionStorage.setItem('selectedJob', JSON.stringify(pendingJob));
      router.push(`/job/${pendingJob.id}`);
      setPendingJob(null);
    } else {
      void fetchJobs();
    }
  };

  // Switching platform clears every scope-dependent selection so no stale
  // value leaks across platforms (skills/budget-type are platform-specific).
  const changePlatform = (next: PlatformScope) => {
    setPlatform(next);
    setJobTypeFilter('all');
    setOpportunityFilter('all');
    setCountryFilter('all');
    setConnectionFilter('all');
    setBudgetFilter('all');
    setPage(1);
  };

  const clearAll = () => {
    setPlatform(DEFAULT_FILTERS.platform);
    setSortBy(DEFAULT_FILTERS.sortBy);
    setJobTypeFilter('all');
    setOpportunityFilter('all');
    setCountryFilter('all');
    setConnectionFilter('all');
    setBudgetFilter('all');
    setSearchQuery('');
    setPage(1);
  };

  if (loading) {
    return (
      <div style={styles.splashLoad}>
        <div style={styles.spinner} />
        <p style={{ marginTop: 16, color: '#64748b', fontSize: 14 }}>Loading opportunities…</p>
      </div>
    );
  }

  const anyFilterActive =
    platform !== DEFAULT_FILTERS.platform || jobTypeFilter !== 'all' || opportunityFilter !== 'all' ||
    countryFilter !== 'all' || connectionFilter !== 'all' || budgetFilter !== 'all' ||
    searchQuery.trim() !== '' ||
    sortBy !== 'recommended';

  return (
    <div style={styles.page} className="lh-page">
      <div style={styles.shell}>

        <AdminLoginModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
        />

        {/* ── HEADER ── */}
        <header style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Logo size={44} />
            <div>
              <h1 style={styles.brand}>Lead Hunter</h1>
              <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, margin: '2px 0 0' }}>
                Stop scrolling. Start winning
              </p>
            </div>
          </div>
          <div style={styles.headerRight}>
            <ThemeToggle />
            <button onClick={() => router.push('/about')} style={styles.btnGhost}>
              About
            </button>
            <button onClick={() => router.push('/trends')} style={styles.btnCron}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconTrend size={14} color="#fff" />
                Market Trends
              </span>
            </button>

            {adminMode && (
              <>
                <button onClick={() => router.push('/cron-logs')} style={styles.btnCron}>
                  Cron Logs
                </button>
                <button onClick={() => router.push('/admin/sessions')} style={{ ...styles.btnCron, background: '#1e3a8a', color: '#fff', borderColor: '#1e3a8a' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <IconShield size={14} color="#fff" />
                    Sessions
                  </span>
                </button>
              </>
            )}
            {authed && (
              <button
                onClick={() => {
                  logout();
                  setAuthed(false);
                  setAdminMode(false);
                }}
                style={{ ...styles.btnGhost, color: '#dc2626', borderColor: '#fca5a5' }}
              >
                Logout
              </button>
            )}
          </div>
        </header>

        {/* ── FRESHNESS ── */}
        {lastSyncedAt && (
          <div className="lh-muted" style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
            Last synced {timeAgo(lastSyncedAt)}
          </div>
        )}

        {/* ── NEW JOBS BANNER ── */}
        {newCount > 0 && (
          <div style={styles.banner}>
            <span><strong>{newCount} new opportunities</strong> just fetched!</span>
            <button onClick={() => { setNewCount(0); setSortBy('date'); setPage(1); }} style={styles.bannerBtn}>View New</button>
          </div>
        )}

        {/* ── STATS (display only) ── */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="lh-h" style={{ fontSize: 13, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {platform === 'all' ? 'All Platforms' : platform} metrics
              </span>
              <span className="lh-muted" style={{ fontSize: 12, color: '#94a3b8' }}>
                from {scopeJobs.length} available {platform === 'all' ? 'listings' : `${platform.toLowerCase()} listings`} in the current feed
              </span>
            </div>
          </div>
          <div style={styles.statsRow}>
            {[
              { label: 'Listings', value: stats.total },
              { label: 'New (24h)', value: stats.new },
              { label: 'Hot (70+)', value: stats.hot },
              { label: 'Applied', value: stats.applied },
            ].map(s => (
            <div key={s.label} className="lh-surface" style={styles.statCard}>
              <div className="lh-h" style={styles.statNum}>{s.value}</div>
              <div className="lh-muted" style={styles.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── FILTERS ── */}
        <div style={styles.filtersBox} className="lh-surface">

          {/* Row 0 — Keyword search (simple, over the real feed) */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Search</span>
            <input
              type="search"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder={`Search ${platform === 'all' ? 'all' : platform} listings — e.g. react, api, flutter…`}
              aria-label="Search jobs"
              style={{
                ...styles.searchInput,
                borderColor: searchQuery ? '#2563eb' : '#dbe2ea',
                background: searchQuery ? '#eff6ff' : '#f8fafc',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setPage(1); }}
                style={styles.clearBtn}
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
          </div>

          {/* Row 1 — Platform + Sort */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Platform</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PLATFORM_OPTIONS.map(p => {
                const active = platform === p;
                const label = p === 'all' ? 'All Platforms' : p;
                return (
                  <button
                    key={p}
                    onClick={() => changePlatform(p)}
                    className={active ? undefined : 'lh-field'}
                    style={{
                      ...styles.pill,
                      background: active ? (p === 'all' ? '#0f172a' : (PLATFORM_COLORS[p] || '#6c5ce7')) : '#f1f5f9',
                      color: active ? '#fff' : '#475569',
                      borderColor: active ? (p === 'all' ? '#0f172a' : (PLATFORM_COLORS[p] || '#6c5ce7')) : '#e2e8f0',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={sortBy} onChange={e => { setSortBy(e.target.value as SortKey); setPage(1); }} style={styles.select} className="lh-field">
                <option value="recommended">Sort: Recommended</option>
                <option value="date">Sort: Newest</option>
                <option value="competition">Sort: Lowest competition</option>
                <option value="budget">Sort: Highest budget</option>
              </select>
              {anyFilterActive && (
                <button onClick={clearAll} style={styles.clearBtn}>Reset</button>
              )}
            </div>
          </div>

          {/* Row 2 — Job Type + Opportunity */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Job Type</span>
            <FilterPill label="All" count={facets.opportunity.all} active={jobTypeFilter === 'all'} color="#2563eb" onClick={() => { setJobTypeFilter('all'); setPage(1); }} />
            {hasFixed && <FilterPill label="Fixed Price" count={facets.jobType.fixed} active={jobTypeFilter === 'fixed'} color="#2563eb" onClick={() => { setJobTypeFilter(prev => prev === 'fixed' ? 'all' : 'fixed'); setPage(1); }} />}
            {hasHourly && <FilterPill label="Hourly" count={facets.jobType.hourly} active={jobTypeFilter === 'hourly'} color="#2563eb" onClick={() => { setJobTypeFilter(prev => prev === 'hourly' ? 'all' : 'hourly'); setPage(1); }} />}

            <span className="lh-muted" style={{ ...styles.filterLabel, marginLeft: 12 }}>Opportunity</span>
            <FilterPill label="All" count={facets.opportunity.all} active={opportunityFilter === 'all'} color="#2563eb" onClick={() => { setOpportunityFilter('all'); setPage(1); }} />
            <FilterPill label="Recommended" count={facets.opportunity.recommended} active={opportunityFilter === 'recommended'} color="#16a34a" onClick={() => { setOpportunityFilter(prev => prev === 'recommended' ? 'all' : 'recommended'); setPage(1); }} />
            <FilterPill label="Act Fast" count={facets.opportunity.actFast} active={opportunityFilter === 'actFast'} color="#d97706" onClick={() => { setOpportunityFilter(prev => prev === 'actFast' ? 'all' : 'actFast'); setPage(1); }} />
          </div>

          {/* Row 3 — Country / Client Connection / Budget (dynamic, platform-scoped) */}
          {(countryOptions.length > 0 || connectionOptions.length > 0 || budgetBuckets.length > 0) && (
            <div style={styles.filterRow}>
              {countryOptions.length > 0 && (
                <FilterSelect
                  label="Country"
                  value={countryFilter}
                  allLabel="All Countries"
                  options={countryOptions.map(c => ({ value: c, label: `${c} (${facets.country[c] ?? 0})` }))}
                  onChange={v => { setCountryFilter(v); setPage(1); }}
                />
              )}
              {connectionOptions.length > 0 && (
                <FilterSelect
                  label="Client Connection"
                  value={connectionFilter}
                  allLabel="All Connections"
                  options={connectionOptions.map(c => ({ value: String(c), label: `${c} connects (${facets.connection[String(c)] ?? 0})` }))}
                  onChange={v => { setConnectionFilter(v); setPage(1); }}
                />
              )}
              {budgetBuckets.length > 0 && (
                <FilterSelect
                  label="Budget"
                  value={budgetFilter}
                  allLabel="All Budgets"
                  options={budgetBuckets.map(b => ({ value: b.label, label: `${b.label} (${facets.budget[b.label] ?? 0})` }))}
                  onChange={v => { setBudgetFilter(v); setPage(1); }}
                />
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="lh-muted" style={{ fontSize: 12, color: '#94a3b8' }}>
              {filteredJobs.length === 0
                ? `No listings match the current ${searchQuery.trim() ? 'search' : 'filters'} across ${platform === 'all' ? 'all platforms' : platform}`
                : `Showing ${Math.min((page - 1) * PER_PAGE + 1, filteredJobs.length)}–${Math.min(page * PER_PAGE, filteredJobs.length)} of ${filteredJobs.length} ${platform === 'all' ? '' : `${platform} `}listing${filteredJobs.length === 1 ? '' : 's'}${filteredJobs.length !== scopeJobs.length ? ` (filtered from ${scopeJobs.length} available)` : ''}`}
            </div>
          </div>
        </div>

        {/* ── JOB GRID ── */}
        {paginatedJobs.length === 0 ? (
          <div style={styles.emptyBox} className="lh-surface">
            <p className="lh-h" style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>No jobs match {searchQuery.trim() ? 'your search' : 'these filters'}</p>
            <p className="lh-body" style={{ color: '#64748b', marginBottom: 16 }}>Try different keywords, widening the filters, or clearing everything, then run a fresh sync.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {anyFilterActive && <button onClick={clearAll} style={styles.btnPrimary}>Clear all filters</button>}
              {adminMode && <button onClick={handleSync} style={styles.btnPrimary}>Sync Now</button>}
            </div>
          </div>
        ) : (
          <div style={styles.grid}>
            {paginatedJobs.map(job => {
              const compTerm = job.platform === 'Freelancer' ? 'Bids' : 'Proposals';
              return (
              <article
                  key={job.id}
                  style={{ ...styles.card, cursor: 'pointer' }}
                  className="lh-surface"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleJobClick(job)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleJobClick(job); } }}
                >
                  {/* Card header badges */}
                  <div style={styles.cardTop}>
                    <span style={{ ...styles.badge, background: PLATFORM_COLORS[job.platform] || '#6c5ce7' }}>
                      {job.platform}
                    </span>
                    {job.category && (
                      <span style={{ ...styles.badge, background: CATEGORY_COLORS[job.category] || '#6c5ce7' }}>
                        {job.category} Lead
                      </span>
                    )}
                    {job.isNew && <span style={{ ...styles.badge, background: '#22c55e' }}>New</span>}
                    {job.applied && <span style={{ ...styles.badge, background: '#3b82f6' }}>Applied</span>}
                    {job.viewed && !job.applied && <span style={{ ...styles.badge, background: '#94a3b8' }}>Viewed</span>}
                    <span className="lh-muted" style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{timeAgo(job.postedAt)}</span>
                  </div>

                  {/* Title */}
                  <h3 style={styles.cardTitle}>{job.title}</h3>

                  {/* Client info */}
                  {(() => {
                    const hasClient = job.clientName && !job.clientName.toLowerCase().includes('client');
                    const hasCountry = job.country && job.country.toLowerCase() !== 'remote' && job.country.trim() !== '';
                    const hasExtra = job.clientSpend || job.clientReviews;
                    if (!hasClient && !hasCountry && !hasExtra) return null;
                    return (
                      <p style={styles.clientLine}>
                        {hasClient ? `Client: ${job.clientName}` : hasCountry ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <IconMapPin size={12} color="#64748b" />
                            {job.country}
                          </span>
                        ) : ''}
                        {job.clientSpend ? ` · Spent: ${job.clientSpend}` : ''}
                        {job.clientReviews ? ` · ${job.clientReviews}` : ''}
                      </p>
                    );
                  })()}

                  {/* Description snippet */}
                  <p style={styles.snippet}>{job.description?.substring(0, 130)}…</p>

                  {/* Real listing signals: competition, repeat client, act-fast */}
                  {(typeof job.proposalCount === 'number' || job.repeatClient || job.actFast) && (
                    <div style={styles.signalRow}>
                      {typeof job.proposalCount === 'number' && (
                        <span
                          className="lh-signal"
                          style={{
                            ...styles.signalChip,
                            color: job.proposalCount <= 5 ? '#15803d' : job.proposalCount <= 20 ? '#b45309' : '#b91c1c',
                            borderColor: job.proposalCount <= 5 ? '#bbf7d0' : job.proposalCount <= 20 ? '#fde68a' : '#fecaca',
                          }}
                        >
                          {job.proposalCount} {compTerm}
                        </span>
                      )}
                      {job.actFast && (
                        <span className="lh-signal" style={{ ...styles.signalChip, color: '#b45309', borderColor: '#fde68a', fontWeight: 700 }}>
                          Act fast
                        </span>
                      )}
                      {job.repeatClient && (
                        <span className="lh-signal" style={{ ...styles.signalChip, color: '#6d28d9', borderColor: '#ddd6fe', fontWeight: 700 }}>
                          {(job.repeatClientCount ?? 0) > 0 ? `${job.repeatClientCount} more from client` : 'Repeat client'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Meta row */}
                  <div style={styles.metaRow}>
                    <div>
                      <div className="lh-muted" style={styles.metaKey}>Budget</div>
                      <div className="lh-h" style={styles.metaVal}>{job.budget || 'Negotiable'}</div>
                    </div>
                    {(job.connections ?? 0) > 0 && (
                      <div>
                        <div className="lh-muted" style={styles.metaKey}>Bid Cost</div>
                        <div style={{ ...styles.metaVal, color: '#2563eb', fontWeight: 700 }}>
                          {job.connections} connects
                        </div>
                      </div>
                    )}
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div className="lh-muted" style={styles.metaKey}>Match</div>
                      <div style={{ ...styles.metaVal, color: getScoreColor(job.score) }}>{job.score}%</div>
                    </div>
                  </div>

                  {/* Score bar */}
                  <div style={styles.barTrack}>
                    <div style={{ ...styles.barFill, width: `${job.score}%`, background: getScoreColor(job.score) }} />
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* ── PAGINATION ── */}
        {totalPages > 1 && (
          <div style={styles.pagination}>
            <button
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="lh-field"
              style={{ ...styles.pageBtn, opacity: page === 1 ? 0.4 : 1 }}
            >
              ← Prev
            </button>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} style={{ color: '#94a3b8', padding: '0 4px' }}>…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => goToPage(p as number)}
                      className={page === p ? 'lh-field lh-active' : 'lh-field'}
                      style={{
                        ...styles.pageBtn,
                        background: page === p ? '#2563eb' : '#fff',
                        color: page === p ? '#fff' : '#334155',
                        borderColor: page === p ? '#2563eb' : '#dbe2ea',
                        fontWeight: page === p ? 700 : 500,
                        minWidth: 36,
                      }}
                    >
                      {p}
                    </button>
                  )
                )
              }
            </div>

            <button
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="lh-field"
              style={{ ...styles.pageBtn, opacity: page === totalPages ? 0.4 : 1 }}
            >
              Next →
            </button>

            <span className="lh-muted" style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>
              Page {page} of {totalPages}
            </span>
          </div>
        )}

        {/* ── FOOTER ── */}
        <footer style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: '1px solid #cbd5e1',
          textAlign: 'center',
          color: '#64748b',
          fontSize: 13,
          lineHeight: 1.6
        }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            Lead Hunter &bull; Developed by <strong style={{ color: '#0f172a' }}>Abdul Raheem</strong> &bull; <a href="mailto:geeksxperts@gmail.com" style={{ color: '#2563eb', textDecoration: 'none' }}>geeksxperts@gmail.com</a>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
            Stop scrolling. Start winning. &copy; {new Date().getFullYear()} All rights reserved.
          </p>
        </footer>

      </div>
    </div>
  );
}

/* ── Small reusable dropdown filter with a live count ── */
function FilterSelect({ label, value, allLabel, options, onChange }: {
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="lh-muted" style={styles.filterLabel}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="lh-field"
        style={styles.select}
        aria-label={label}
      >
        <option value="all">{allLabel}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}

/* ── Small reusable filter pill with a live count ── */
function FilterPill({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={active ? undefined : 'lh-field'}
      style={{
        ...styles.oppPill,
        background: active ? color : '#f1f5f9',
        color: active ? '#fff' : '#475569',
        borderColor: active ? color : '#e2e8f0',
      }}
    >
      {label} <span style={{ ...styles.oppCount, background: active ? 'rgba(255,255,255,0.25)' : '#e2e8f0', color: active ? '#fff' : '#64748b' }}>{count}</span>
    </button>
  );
}

/* ── STYLES ─────────────────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)',
    color: '#111827',
    padding: '24px 16px',
  },
  shell: { maxWidth: 1320, margin: '0 auto' },

  splashLoad: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #dbeafe',
    borderTopColor: '#2563eb',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  brand: { fontSize: 26, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.03em' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  btnPrimary: {
    background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: 999, padding: '10px 18px', fontSize: 13,
    fontWeight: 700, cursor: 'pointer',
  },
  btnGhost: {
    background: '#fff', color: '#475569',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 999, padding: '10px 14px', fontSize: 13, cursor: 'pointer',
  },
  banner: {
    background: '#eff6ff',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#bfdbfe',
    borderRadius: 12, padding: '12px 16px', marginBottom: 20,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexWrap: 'wrap', gap: 10, color: '#1d4ed8',
  },
  bannerBtn: {
    background: '#2563eb', color: '#fff', border: 'none',
    borderRadius: 999, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  btnCron: {
    background: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 4px rgba(22,163,74,0.2)'
  },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 },
  statCard: {
    background: '#fff', borderRadius: 14, padding: '16px',
    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
  },
  statNum: { fontSize: 28, fontWeight: 800, color: '#0f172a' },
  statLabel: { fontSize: 13, color: '#64748b', marginTop: 2 },

  filtersBox: {
    background: '#fff',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 16, padding: '16px 20px', marginBottom: 24,
    display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
  },
  filterRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  filterLabel: { fontSize: 12, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
  searchInput: {
    flex: 1, minWidth: 'min(240px,100%)',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 999, padding: '10px 16px', fontSize: 13, color: '#0f172a',
    background: '#f8fafc',
  },
  select: {
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 999, padding: '8px 14px', fontSize: 13,
    color: '#334155', background: '#fff', cursor: 'pointer',
  },
  pill: {
    borderWidth: '1px', borderStyle: 'solid',
    borderRadius: 999, padding: '6px 14px', fontSize: 12,
    fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
  },
  oppPill: {
    borderWidth: '1px', borderStyle: 'solid',
    borderRadius: 999, padding: '6px 12px', fontSize: 12,
    fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  oppCount: {
    borderRadius: 999, padding: '0 7px', fontSize: 11,
    fontWeight: 800,
  },
  skillChip: {
    borderWidth: '1px', borderStyle: 'solid',
    borderRadius: 999, padding: '5px 11px', fontSize: 11.5,
    fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  skillCount: { fontSize: 10.5, fontWeight: 700 },
  clearChip: {
    background: 'none', border: 'none', fontSize: 11.5, cursor: 'pointer',
    color: '#94a3b8', textDecoration: 'underline', padding: '5px 4px',
  },
  clearBtn: {
    background: '#f1f5f9', color: '#475569',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  suggestBox: {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
    zIndex: 50, borderRadius: 12, overflow: 'hidden',
    boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
  },
  suggestItem: {
    display: 'block', width: '100%', textAlign: 'left', border: 'none',
    background: 'transparent', padding: '10px 16px', fontSize: 13,
    cursor: 'pointer', color: '#334155',
  },
  smartChip: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    borderRadius: 999, padding: '4px 12px', fontSize: 12,
    fontWeight: 600, color: '#1d4ed8', background: '#eff6ff',
    border: '1px solid #bfdbfe',
  },
  smartChipX: {
    background: 'none', border: 'none', fontSize: 14, lineHeight: 1,
    cursor: 'pointer', color: '#1d4ed8', padding: 0,
  },
  signalRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  signalChip: {
    fontSize: 11, fontWeight: 600, padding: '2px 9px',
    borderRadius: 999, borderWidth: '1px', borderStyle: 'solid',
    background: '#fff',
  },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(340px,100%),1fr))', gap: 16 },
  card: {
    background: '#fff',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 18, padding: '18px 20px',
    boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
    transition: 'box-shadow 0.15s, transform 0.15s',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardTop: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  badge: { color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700 },
  cardTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', lineHeight: 1.35, margin: 0 },
  clientLine: { fontSize: 12, color: '#64748b', margin: 0 },
  snippet: { fontSize: 13, color: '#64748b', lineHeight: 1.55, margin: 0 },
  metaRow: { display: 'flex', alignItems: 'flex-end', gap: 16 },
  metaKey: { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', marginBottom: 2 },
  metaVal: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  barTrack: { height: 5, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, transition: 'width 0.3s' },

  emptyBox: {
    background: '#fff',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 18, padding: '48px 24px', textAlign: 'center',
    boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
  },

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 32 },
  pageBtn: {
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    background: '#fff', borderRadius: 999, padding: '8px 16px',
    fontSize: 13, cursor: 'pointer', color: '#334155',
  },
};
