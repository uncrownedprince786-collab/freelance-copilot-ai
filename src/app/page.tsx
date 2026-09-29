'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, isAdmin, logout, trackActivity } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Logo } from '@/components/Logo';
import { IconTrend, IconShield, IconMapPin } from '@/components/icons';
import { timeAgo } from '@/lib/format';

/**
 * Leads — the lead-intelligence dashboard.
 *
 * The three rules this screen exists to keep:
 *
 * 1. **Latest and Recommended never blend.** Latest is the source's posting
 *    time and nothing else. Recommended is the lead score. The switch is a
 *    tablist, the active view is stated in words above the results, and the
 *    ordering is done in SQL by /api/jobs so the client cannot re-sort one
 *    into the other.
 *
 * 2. **No number is shown without what it means.** A lead score always
 *    carries its reasons and risks (expandable, never hidden). A proposal
 *    count is rendered through competition.label, which says WHEN it was
 *    captured, because it is a snapshot taken shortly after the listing was
 *    found and is never refreshed.
 *
 * 3. **No filter the data cannot back.** paymentVerified is false on every
 *    stored row and clientName is empty on every stored row, so neither is
 *    offered as a filter or asserted as a badge.
 *
 * Filtering, ordering and paging are all server-side. The previous version
 * pulled the entire table over cursor pagination and filtered in the browser.
 */

const FILTERS_KEY = 'lh_leads_filters_v2';
const PER_PAGE = 24;

type View = 'latest' | 'recommended';
type PlatformScope = 'all' | string;

const LEAD_BANDS = ['high', 'promising', 'moderate', 'low', 'insufficient_data'] as const;
const AUTH_STATUSES = ['supported', 'uncertain', 'suspicious', 'stale', 'rejected', 'verified'] as const;
const FRESHNESS_STATES = ['just_posted', 'fresh', 'active', 'aging', 'stale', 'expired', 'unknown'] as const;
const BUDGET_TYPES = ['fixed', 'hourly'] as const;
const COMPETITION_BUCKETS = ['low', 'medium', 'high', 'unpublished'] as const;

type LeadBand = (typeof LEAD_BANDS)[number];
type AuthStatus = (typeof AUTH_STATUSES)[number];
type FreshnessState = (typeof FRESHNESS_STATES)[number];
type BudgetType = (typeof BUDGET_TYPES)[number];
type CompetitionBucket = (typeof COMPETITION_BUCKETS)[number];

const LEAD_BAND_LABEL: Record<string, string> = {
  high: 'High',
  promising: 'Promising',
  moderate: 'Moderate',
  low: 'Low',
  insufficient_data: 'Not scored',
};

const LEAD_BAND_COLOR: Record<string, string> = {
  high: '#15803d',
  promising: '#1d4ed8',
  moderate: '#b45309',
  low: '#64748b',
  insufficient_data: '#64748b',
};

const AUTH_LABEL: Record<string, string> = {
  verified: 'Re-checked at source',
  supported: 'Corroborated',
  uncertain: 'Unconfirmed',
  suspicious: 'Flagged',
  stale: 'Stale',
  rejected: 'Rejected',
};

/** What each authenticity status actually means, in the UI's own words. No
 *  status claims the listing was re-fetched unless it was — and this system
 *  never re-fetches, so `verified` is unreachable by design. */
const AUTH_MEANING: Record<string, string> = {
  verified: 'The source listing was re-fetched and confirmed.',
  supported: 'Two or more independent details corroborate this listing.',
  uncertain: 'Nothing contradicts this listing, but little corroborates it either.',
  suspicious: 'Something in the listing text warrants a closer look before you bid.',
  stale: 'The posting time is old enough that the listing may no longer be open.',
  rejected: 'This listing failed a basic coherence check.',
};

const AUTH_COLOR: Record<string, string> = {
  verified: '#15803d',
  supported: '#15803d',
  uncertain: '#64748b',
  suspicious: '#b91c1c',
  stale: '#b45309',
  rejected: '#b91c1c',
};

const FRESHNESS_LABEL: Record<string, string> = {
  just_posted: 'Just posted',
  fresh: 'Under 6 hours',
  active: 'Under a day',
  aging: ' 1–3 days',
  stale: '3–7 days',
  expired: 'Over 7 days',
  unknown: 'No posting time',
};

const BUDGET_TYPE_LABEL: Record<string, string> = {
  fixed: 'Fixed price',
  hourly: 'Hourly',
};

const COMPETITION_LABEL: Record<string, string> = {
  low: '0–5 when checked',
  medium: '6–20 when checked',
  high: 'Over 20 when checked',
  unpublished: 'No count published',
};

const DUPLICATE_LABEL: Record<string, string> = {
  canonical: 'Primary of a group',
  duplicate: 'Repeat of another listing',
  possible_duplicate: 'Possibly a repeat',
  independent: '',
  unknown: '',
};

/** Authenticity signals and warnings are stored as reason codes. They are
 *  translated here rather than shown raw; an unknown code de-snake-cases so a
 *  new code never renders as machine output. */
const AUTH_CODE_LABEL: Record<string, string> = {
  resolvable_url: 'The listing URL is well-formed and reachable in shape',
  source_native_id: 'Carries the source’s own job id',
  coherent_posting_time: 'Posting time is coherent',
  substantive_description: 'Description has real substance',
  stated_budget: 'A budget is stated',
  competition_data: 'The source published a proposal count',
  skills_listed: 'Skills are listed',
  client_spend: 'Client spend history is published',
  client_rating: 'A client rating is published',
  client_history: 'The client’s posting history is published',
  missing_title: 'No title',
  missing_description: 'No description',
  unusable_url: 'The listing URL is not usable',
  no_source_id: 'The source published no job id for this listing',
  no_posting_time: 'The source published no posting time',
  future_posting_time: 'Posting time is in the future',
  stale_posting: 'Posted long enough ago that it may be closed',
  short_description: 'Very short description',
  offsite_contact_request: 'Asks you to make contact off-platform',
  unstated_budget: 'No budget stated',
  proposal_count_at_source_cap: 'Proposal count sits at the source’s display cap',
  no_competition_data: 'No proposal count published',
  no_client_data_published: 'This source publishes no client information',
  payment_verification_not_published: 'The source did not publish payment verification either way',
};

function codeLabel(code: string): string {
  const known = AUTH_CODE_LABEL[code];
  if (known) return known;
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PLATFORM_COLORS: Record<string, string> = {
  Upwork: '#14a800',
  Freelancer: '#29b2fe',
  RemoteOK: '#ff6b35',
  'Remote OK': '#ff6b35',
  WeWorkRemotely: '#3b82f6',
  Remotive: '#7c3aed',
};

interface CompetitionView {
  count: number | null;
  observedAt: string | null;
  observationAgeHours: number | null;
  outdated: boolean;
  label: string;
}

interface Job {
  id: string;
  title: string;
  description: string;
  url: string;
  platform: string;
  budget: string;
  budgetType?: string;
  viewed: boolean;
  applied: boolean;
  postedAt: string;
  country?: string;
  connections?: number;
  skills?: string[];
  experienceLevel?: string;
  duration?: string;

  leadScore: number | null;
  leadBand: string;
  leadReasons: string[];
  leadRisks: string[];
  authenticityStatus: string;
  authenticitySignals: string[];
  authenticityWarnings: string[];
  duplicateStatus: string;
  duplicateClusterId: string | null;
  canonicalJobId: string | null;
  canonicalReason: string | null;
  clusterSize: number | null;
  freshnessState: string;
  ageLabel: string;
  competition: CompetitionView;
}

interface Facets {
  leadBand: Record<string, number>;
  authenticity: Record<string, number>;
  platform: Record<string, number>;
}

interface FeedResponse {
  view: View;
  jobs: Job[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  facets?: Facets;
  generatedAt: string;
  error?: string;
}

interface FilterState {
  platform: PlatformScope;
  leadBand: LeadBand[];
  authenticity: AuthStatus[];
  freshness: FreshnessState[];
  budgetType: BudgetType[];
  competition: CompetitionBucket[];
  skills: string[];
  collapseDuplicates: boolean;
  q: string;
}

const DEFAULT_FILTERS: FilterState = {
  platform: 'all',
  leadBand: [],
  authenticity: [],
  freshness: [],
  budgetType: [],
  competition: [],
  skills: [],
  collapseDuplicates: false,
  q: '',
};

function sanitiseList<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is T => typeof v === 'string' && (allowed as readonly string[]).includes(v));
}

function loadFilters(): FilterState {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw) as Partial<FilterState>;
    return {
      platform: typeof p.platform === 'string' && p.platform.length <= 40 ? p.platform : 'all',
      leadBand: sanitiseList(p.leadBand, LEAD_BANDS),
      authenticity: sanitiseList(p.authenticity, AUTH_STATUSES),
      freshness: sanitiseList(p.freshness, FRESHNESS_STATES),
      budgetType: sanitiseList(p.budgetType, BUDGET_TYPES),
      competition: sanitiseList(p.competition, COMPETITION_BUCKETS),
      skills: Array.isArray(p.skills) ? p.skills.filter(s => typeof s === 'string').slice(0, 6) : [],
      collapseDuplicates: p.collapseDuplicates === true,
      q: typeof p.q === 'string' ? p.q.slice(0, 200) : '',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: FilterState) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f)); } catch { /* quota/non-window */ }
}

function loadView(): View {
  if (typeof window === 'undefined') return 'recommended';
  return sessionStorage.getItem('lh_leads_view') === 'latest' ? 'latest' : 'recommended';
}

function filtersActive(f: FilterState): boolean {
  return f.platform !== 'all'
    || f.leadBand.length > 0
    || f.authenticity.length > 0
    || f.freshness.length > 0
    || f.budgetType.length > 0
    || f.competition.length > 0
    || f.skills.length > 0
    || f.collapseDuplicates
    || f.q.trim() !== '';
}

function buildQuery(view: View, f: FilterState, page: number): string {
  const p = new URLSearchParams();
  p.set('view', view);
  p.set('limit', String(PER_PAGE));
  p.set('offset', String((page - 1) * PER_PAGE));
  p.set('facets', '1');
  if (f.platform !== 'all') p.set('platform', f.platform);
  if (f.q.trim()) p.set('q', f.q.trim().slice(0, 200));
  if (f.leadBand.length) p.set('leadBand', f.leadBand.join(','));
  if (f.authenticity.length) p.set('authenticity', f.authenticity.join(','));
  if (f.freshness.length) p.set('freshness', f.freshness.join(','));
  if (f.budgetType.length) p.set('budgetType', f.budgetType.join(','));
  if (f.competition.length) p.set('competition', f.competition.join(','));
  if (f.skills.length) p.set('skills', f.skills.join(','));
  if (f.collapseDuplicates) p.set('duplicates', 'collapse');
  return p.toString();
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/**
 * Presence heartbeat interval.
 *
 * Neon Free scales the database to zero after 5 minutes of inactivity and
 * that timeout cannot be disabled, so a 5-minute heartbeat was the worst
 * possible value: every beat landed exactly as the database was about to
 * suspend, and a single open tab kept it awake indefinitely. The free plan
 * allows 100 CU-hours per month; one tab left open for a working day at
 * 1 CU is roughly 240 CU-hours a month on its own.
 *
 * 20 minutes leaves the database suspended for three quarters of the time
 * even with a tab open, and the beat is additionally gated on real user
 * interaction below — an open-but-idle tab stops beating altogether.
 *
 * /api/sessions/track's "Active" threshold must stay above this.
 */
const HEARTBEAT_MS = 20 * 60_000;

// Backoff for recovering from an unreachable feed. A fixed retry re-ran the
// whole fetch forever from every open tab — including while the database was
// down, which is exactly when hammering it helps least.
const RECOVERY_MIN_MS = 2 * 60_000;
const RECOVERY_MAX_MS = 30 * 60_000;

export default function Home() {
  return (
    <React.Suspense fallback={<FullPageLoading />}>
      <HomeContent />
    </React.Suspense>
  );
}

function HomeContent() {
  const router = useRouter();

  const [view, setView] = useState<View>(() => loadView());
  const [filters, setFilters] = useState<FilterState>(() => loadFilters());
  const [page, setPage] = useState(1);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Three distinct conditions, never collapsed into one another: the first
  // load has not finished, a request failed, or the request succeeded and
  // returned nothing.
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

  const [authed, setAuthed] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingJob, setPendingJob] = useState<Job | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [skillDraft, setSkillDraft] = useState('');
  const [searchDraft, setSearchDraft] = useState<string>(() => loadFilters().q);

  const liveRegionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAuthed(isAuthenticated());
      setAdminMode(isAdmin());
    }
  }, []);

  // Session heartbeat. Skipped while the tab is hidden, and skipped again
  // unless the person actually did something since the last beat — presence
  // is worth one write when someone is working, and nothing at all when a
  // tab has simply been left open. Each beat wakes a database that would
  // otherwise be suspended, so an ungated timer is a standing compute cost
  // for no product value.
  useEffect(() => {
    if (!authed) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    // The page load itself counts, so a fresh visit registers immediately.
    let interacted = true;
    const mark = () => { interacted = true; };
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('keydown', mark, { passive: true });
    document.addEventListener('visibilitychange', mark);
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      if (!interacted) return;
      interacted = false;
      trackActivity('heartbeat');
    };
    const idle = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(idle);
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [authed]);

  useEffect(() => { saveFilters(filters); }, [filters]);
  useEffect(() => {
    if (typeof window !== 'undefined') sessionStorage.setItem('lh_leads_view', view);
  }, [view]);

  // Debounce the search box so typing does not issue a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(prev => (prev.q === searchDraft ? prev : { ...prev, q: searchDraft }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const query = useMemo(() => buildQuery(view, filters, page), [view, filters, page]);

  const load = useCallback(async (qs: string, silent: boolean) => {
    if (silent) setRefreshing(true);
    try {
      const res = await fetch(`/api/jobs?${qs}`);
      const json = (await res.json().catch(() => null)) as FeedResponse | null;
      if (!res.ok) {
        // 400 means this client asked for something invalid — retrying will
        // not fix it, and saying "we are retrying" would be a lie.
        const retryable = res.status !== 400;
        throw Object.assign(
          new Error(json?.error || (retryable ? 'The job feed is unavailable right now.' : 'That filter combination was rejected.')),
          { retryable },
        );
      }
      const list = Array.isArray(json?.jobs) ? json!.jobs : [];
      // Guests see no server-persisted viewed/applied state — both are kept
      // per-tab so a guest's history stays private to the browsing session.
      const role = typeof window !== 'undefined' ? sessionStorage.getItem('lh_auth_role') : null;
      const isAdminUser = role === 'admin';
      let guestApplied = new Set<string>();
      let guestViewed = new Set<string>();
      if (!isAdminUser && typeof window !== 'undefined') {
        try { guestApplied = new Set(JSON.parse(sessionStorage.getItem('guest_applied') || '[]')); } catch { /* ignore */ }
        try { guestViewed = new Set(JSON.parse(sessionStorage.getItem('guest_viewed') || '[]')); } catch { /* ignore */ }
      }
      setJobs(list.map(j => ({
        ...j,
        applied: isAdminUser ? j.applied : guestApplied.has(j.id),
        viewed: isAdminUser ? j.viewed : guestViewed.has(j.id),
      })));
      setTotal(json?.total ?? 0);
      setFacets(json?.facets ?? null);
      setGeneratedAt(json?.generatedAt ?? null);
      setError(null);
    } catch (err) {
      // "The feed is down" and "the feed is empty" are different facts. The
      // list is cleared rather than left showing results that no longer
      // correspond to the request — stale rows under new filters read as
      // fabricated data.
      const retryable = (err as { retryable?: boolean })?.retryable !== false;
      setJobs([]);
      setTotal(0);
      setError({ message: (err as Error).message || 'The job feed is unavailable right now.', retryable });
    } finally {
      setInitialLoad(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(query, true); }, [query, load]);

  // Retry only what retrying can fix, and back off while doing it.
  useEffect(() => {
    if (!error?.retryable) return;
    let delay = RECOVERY_MIN_MS;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void load(query, true);
      delay = Math.min(delay * 2, RECOVERY_MAX_MS);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [error, query, load]);

  // When the sources were last checked. This is the only freshness claim the
  // page makes about the data as a whole, and it is never phrased as "live".
  useEffect(() => {
    fetch('/api/sync/status')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then(d => { if (d?.lastSyncedAt) setLastSyncedAt(d.lastSyncedAt); })
      .catch(() => { /* freshness telemetry is non-critical */ });
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const anyFilter = filtersActive(filters);

  const patch = useCallback((next: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...next }));
    setPage(1);
  }, []);

  const clearAll = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSearchDraft('');
    setPage(1);
  }, []);

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changeView = (next: View) => {
    if (next === view) return;
    setView(next);
    setPage(1);
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = next === 'latest'
        ? 'Showing Latest — newest first, chronological only.'
        : 'Showing Recommended — ranked by lead score.';
    }
  };

  const openJob = (job: Job) => {
    if (!isAuthenticated()) {
      setPendingJob(job);
      setShowAuthModal(true);
      return;
    }
    const role = typeof window !== 'undefined' ? sessionStorage.getItem('lh_auth_role') : null;
    if (role !== 'admin' && typeof window !== 'undefined') {
      try {
        const seen: string[] = JSON.parse(sessionStorage.getItem('guest_viewed') || '[]');
        if (!seen.includes(job.id)) {
          seen.push(job.id);
          sessionStorage.setItem('guest_viewed', JSON.stringify(seen));
        }
      } catch { /* ignore */ }
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
      void load(query, false);
    }
  };

  const handleSync = async () => {
    try {
      const res = await fetch('/api/sync?force=true', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.newJobs > 0) {
        trackActivity('sync', `${data.newJobs} new jobs`);
        await load(query, true);
      }
    } catch { /* ignore */ }
  };

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addSkill = () => {
    const s = skillDraft.trim().slice(0, 40);
    if (!s || filters.skills.includes(s) || filters.skills.length >= 6) return;
    patch({ skills: [...filters.skills, s] });
    setSkillDraft('');
  };

  const platformOptions = useMemo(() => {
    const fromFacets = facets ? Object.keys(facets.platform) : [];
    const known = ['Upwork', 'Freelancer'];
    return [...new Set([...known, ...fromFacets])].sort();
  }, [facets]);

  if (initialLoad) return <FullPageLoading />;

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <Logo size={44} />
            <div style={{ minWidth: 0 }}>
              <h1 style={styles.brand}>Lead Hunter</h1>
              <p className="lh-muted" style={styles.brandSub}>Freelance lead intelligence</p>
            </div>
          </div>
          <div style={styles.headerRight}>
            <ThemeToggle />
            <button onClick={() => router.push('/trading')} style={styles.btnAccent} className="lh-field">
              <span style={styles.btnInner}><IconTrend size={14} color="#fff" />Market Trending</span>
            </button>
            <button onClick={() => router.push('/about')} style={styles.btnGhost} className="lh-field">About</button>
            {adminMode && (
              <>
                <button onClick={() => router.push('/cron-logs')} style={styles.btnGhost} className="lh-field">Cron Logs</button>
                <button onClick={() => router.push('/admin/sessions')} style={styles.btnGhost} className="lh-field">
                  <span style={styles.btnInner}><IconShield size={14} />Sessions</span>
                </button>
              </>
            )}
            {authed && (
              <button
                onClick={() => { logout(); setAuthed(false); setAdminMode(false); }}
                style={styles.btnGhost}
                className="lh-field"
              >
                <span style={{ color: '#ef4444', fontWeight: 700 }}>Logout</span>
              </button>
            )}
          </div>
        </header>

        {/* ── PROVENANCE STRIP ──
            Everything the page can honestly say about how current the data is,
            in one place, so no individual card has to imply real time. */}
        <div style={styles.provenance} className="lh-surface">
          <div style={styles.provItem}>
            <span className="lh-muted" style={styles.provKey}>Sources last checked</span>
            <span className="lh-h" style={styles.provVal}>{lastSyncedAt ? timeAgo(lastSyncedAt) : 'Not recorded'}</span>
          </div>
          <div style={styles.provItem}>
            <span className="lh-muted" style={styles.provKey}>This page read at</span>
            <span className="lh-h" style={styles.provVal}>{generatedAt ? timeAgo(generatedAt) : '—'}</span>
          </div>
          <p className="lh-muted" style={styles.provNote}>
            Nothing here is a live feed. Proposal counts are captured shortly after a listing is
            found and are never refreshed, so each one is shown with the age of the reading.
            Lead scores, authenticity and duplicate grouping are this system&rsquo;s own assessment,
            not a claim made by the source.
          </p>
        </div>

        {/* ── VIEW SWITCH ── */}
        <div style={styles.viewBlock}>
          <div style={styles.tablist} role="tablist" aria-label="Feed ordering">
            {(['latest', 'recommended'] as View[]).map(v => {
              const active = view === v;
              return (
                <button
                  key={v}
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeView(v)}
                  className={active ? 'lh-active' : 'lh-field'}
                  style={{
                    ...styles.tab,
                    background: active ? '#0f172a' : 'transparent',
                    color: active ? '#fff' : '#475569',
                    borderColor: active ? '#0f172a' : '#dbe2ea',
                  }}
                >
                  {v === 'latest' ? 'Latest' : 'Recommended'}
                </button>
              );
            })}
          </div>
          <p className="lh-body" style={styles.viewExplainer}>
            {view === 'latest'
              ? 'Strictly chronological: newest posting time first, nothing else. No score, ranking or quality signal affects this order. Listings whose source published no posting time appear last.'
              : 'Ranked by lead score, highest first. Every score below carries the reasons behind it. Listings this system could not score appear last rather than being hidden.'}
          </p>
          <div ref={liveRegionRef} aria-live="polite" style={styles.srOnly} />
        </div>

        {/* ── FILTERS ── */}
        <section style={styles.filtersBox} className="lh-surface" aria-label="Filters">
          <div style={styles.filterRow}>
            <label className="lh-muted" style={styles.filterLabel} htmlFor="lead-search">Search</label>
            <input
              id="lead-search"
              type="search"
              className="lh-field"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              placeholder="Title, description or skill — e.g. react, scraping, logo"
              style={{ ...styles.searchInput, borderColor: searchDraft ? '#2563eb' : '#dbe2ea' }}
            />
            {searchDraft && (
              <button onClick={() => setSearchDraft('')} style={styles.clearBtn} className="lh-field">Clear</button>
            )}
          </div>

          <FilterGroup label="Source">
            <Pill
              label="All sources"
              active={filters.platform === 'all'}
              onClick={() => patch({ platform: 'all' })}
            />
            {platformOptions.map(p => (
              <Pill
                key={p}
                label={p}
                count={facets?.platform[p]}
                color={PLATFORM_COLORS[p] || '#0f172a'}
                active={filters.platform === p}
                onClick={() => patch({ platform: filters.platform === p ? 'all' : p })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Lead band" hint="This system's own assessment">
            {LEAD_BANDS.map(b => (
              <Pill
                key={b}
                label={LEAD_BAND_LABEL[b]}
                count={facets?.leadBand[b]}
                color={LEAD_BAND_COLOR[b]}
                active={filters.leadBand.includes(b)}
                onClick={() => patch({ leadBand: toggle(filters.leadBand, b) })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Authenticity" hint="Deterministic checks, never a model verdict">
            {AUTH_STATUSES
              // Only offer a status the data actually contains. `verified` is
              // unreachable by design, so it is never rendered as a choice.
              .filter(s => (facets?.authenticity[s] ?? 0) > 0 || filters.authenticity.includes(s))
              .map(s => (
                <Pill
                  key={s}
                  label={AUTH_LABEL[s]}
                  count={facets?.authenticity[s]}
                  color={AUTH_COLOR[s]}
                  active={filters.authenticity.includes(s)}
                  onClick={() => patch({ authenticity: toggle(filters.authenticity, s) })}
                />
              ))}
          </FilterGroup>

          <FilterGroup label="Age" hint="By the source's posting time">
            {FRESHNESS_STATES.map(s => (
              <Pill
                key={s}
                label={FRESHNESS_LABEL[s]}
                active={filters.freshness.includes(s)}
                onClick={() => patch({ freshness: toggle(filters.freshness, s) })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Budget" hint="As the source stated it">
            {BUDGET_TYPES.map(t => (
              <Pill
                key={t}
                label={BUDGET_TYPE_LABEL[t]}
                active={filters.budgetType.includes(t)}
                onClick={() => patch({ budgetType: toggle(filters.budgetType, t) })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Competition" hint="Counts as captured, not as they are now">
            {COMPETITION_BUCKETS.map(c => (
              <Pill
                key={c}
                label={COMPETITION_LABEL[c]}
                active={filters.competition.includes(c)}
                onClick={() => patch({ competition: toggle(filters.competition, c) })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Skills" hint="Every skill must be present. Most listings publish no skill list and are excluded when this is used.">
            {filters.skills.map(s => (
              <span key={s} style={styles.skillChip} className="lh-field">
                {s}
                <button
                  onClick={() => patch({ skills: filters.skills.filter(x => x !== s) })}
                  style={styles.skillX}
                  aria-label={`Remove skill filter ${s}`}
                >
                  ×
                </button>
              </span>
            ))}
            {filters.skills.length < 6 && (
              <span style={styles.skillAdd}>
                <input
                  className="lh-field"
                  value={skillDraft}
                  onChange={e => setSkillDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                  placeholder="Add a skill"
                  aria-label="Add a skill filter"
                  style={styles.skillInput}
                />
                <button onClick={addSkill} style={styles.clearBtn} className="lh-field" disabled={!skillDraft.trim()}>Add</button>
              </span>
            )}
          </FilterGroup>

          <FilterGroup label="Duplicates">
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={filters.collapseDuplicates}
                onChange={e => patch({ collapseDuplicates: e.target.checked })}
              />
              <span className="lh-body" style={{ fontSize: 13 }}>
                Collapse confirmed repeats to one listing
              </span>
            </label>
            <span className="lh-muted" style={styles.groupHint}>
              Only confirmed repeats are hidden, and only when the listing they repeat is still
              present. Possible duplicates always stay visible.
            </span>
          </FilterGroup>

          <div style={styles.resultLine}>
            <span className="lh-muted" style={{ fontSize: 12.5 }}>
              {total === 0
                ? 'No listings match'
                : `${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, total)} of ${total.toLocaleString()} listing${total === 1 ? '' : 's'}`}
              {refreshing ? ' · updating…' : ''}
            </span>
            {anyFilter && <button onClick={clearAll} style={styles.clearBtn} className="lh-field">Reset all filters</button>}
          </div>
        </section>

        {/* ── RESULTS ── */}
        {error ? (
          <div style={styles.stateBox} className="lh-surface" role="alert">
            <h2 className="lh-h" style={styles.stateTitle}>
              {error.retryable ? 'The job feed is unreachable' : 'That request was rejected'}
            </h2>
            <p className="lh-body" style={styles.stateBody}>
              {error.message}
              {error.retryable
                ? ' This is on our side, not yours. Nothing has been lost, and we are retrying automatically.'
                : ' Reset the filters and try again.'}
            </p>
            <div style={styles.stateActions}>
              <button onClick={() => { void load(query, false); }} style={styles.btnPrimary}>Try again now</button>
              {anyFilter && <button onClick={clearAll} style={styles.btnGhost} className="lh-field">Reset filters</button>}
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <div style={styles.stateBox} className="lh-surface">
            <h2 className="lh-h" style={styles.stateTitle}>
              {anyFilter ? 'No listings match these filters' : 'No listings stored yet'}
            </h2>
            <p className="lh-body" style={styles.stateBody}>
              {anyFilter
                ? 'Every filter is applied together, so a narrow combination can legitimately return nothing. Widen or reset them to see what is actually stored.'
                : 'The database currently holds no opportunities. Nothing is shown here until real listings arrive from a source — this page never displays sample data.'}
            </p>
            <div style={styles.stateActions}>
              {anyFilter && <button onClick={clearAll} style={styles.btnPrimary}>Reset all filters</button>}
              {adminMode && <button onClick={handleSync} style={styles.btnGhost} className="lh-field">Run a sync now</button>}
            </div>
          </div>
        ) : (
          <div style={styles.grid}>
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                view={view}
                expanded={expanded.has(job.id)}
                onToggle={() => toggleExpanded(job.id)}
                onOpen={() => openJob(job)}
              />
            ))}
          </div>
        )}

        {/* ── PAGINATION ── */}
        {!error && totalPages > 1 && (
          <nav style={styles.pagination} aria-label="Pagination">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="lh-field"
              style={{ ...styles.pageBtn, opacity: page === 1 ? 0.4 : 1 }}
            >
              ← Prev
            </button>
            <span className="lh-muted" style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="lh-field"
              style={{ ...styles.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
            >
              Next →
            </button>
          </nav>
        )}

        <footer style={styles.footer}>
          <p className="lh-body" style={{ margin: 0, fontWeight: 600 }}>
            Lead Hunter &bull; Developed by <strong className="lh-h">Abdul Raheem</strong> &bull;{' '}
            <a href="mailto:geeksxperts@gmail.com" style={{ color: '#2563eb', textDecoration: 'none' }}>geeksxperts@gmail.com</a>
          </p>
          <p className="lh-muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            &copy; {new Date().getFullYear()} All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ── Loading ─────────────────────────────────────────────────────────
   A deliberate, non-animated-content loading state. It never renders
   placeholder job rows, because a skeleton shaped like a listing is
   indistinguishable from a listing until it is not. */
function FullPageLoading() {
  return (
    <div style={styles.splashLoad} className="lh-page" role="status" aria-live="polite">
      <div style={styles.spinner} />
      <p className="lh-muted" style={{ marginTop: 16, fontSize: 14 }}>Loading stored leads…</p>
    </div>
  );
}

/* ── Job card ─────────────────────────────────────────────────────── */
function JobCard({ job, view, expanded, onToggle, onOpen }: {
  job: Job;
  view: View;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const bandColor = LEAD_BAND_COLOR[job.leadBand] || '#64748b';
  const authColor = AUTH_COLOR[job.authenticityStatus] || '#64748b';
  const hasExplanation = job.leadReasons.length > 0 || job.leadRisks.length > 0;
  const dupLabel = DUPLICATE_LABEL[job.duplicateStatus] || '';

  return (
    <article style={styles.card} className="lh-surface">
      <div style={styles.cardTop}>
        <span style={{ ...styles.badge, background: PLATFORM_COLORS[job.platform] || '#475569' }}>
          {job.platform}
        </span>
        {job.applied && <span style={{ ...styles.badge, background: '#1d4ed8' }}>Applied</span>}
        {job.viewed && !job.applied && <span style={{ ...styles.badge, background: '#94a3b8' }}>Viewed</span>}
        <span className="lh-muted" style={styles.ageLabel}>{job.ageLabel}</span>
      </div>

      <h3 style={styles.cardTitle}>
        <button onClick={onOpen} style={styles.titleBtn} className="lh-h">{job.title || 'Untitled listing'}</button>
      </h3>

      {/* Lead assessment — never a bare number. The band, the score and the
          way in are one block, and the explanation is one click away. */}
      <div style={{ ...styles.assessment, borderLeftColor: bandColor }}>
        <div style={styles.assessTop}>
          <span style={{ ...styles.bandLabel, background: bandColor }}>
            {LEAD_BAND_LABEL[job.leadBand] || 'Not scored'}
            {job.leadScore !== null && <span style={styles.scoreNum}> · {job.leadScore}/100</span>}
          </span>
          {hasExplanation ? (
            <button onClick={onToggle} aria-expanded={expanded} style={styles.whyBtn} className="lh-field">
              {expanded ? 'Hide reasoning' : `Why? (${job.leadReasons.length + job.leadRisks.length})`}
            </button>
          ) : (
            <span className="lh-muted" style={{ fontSize: 11.5 }}>No reasoning recorded</span>
          )}
        </div>
        {job.leadScore === null && (
          <p className="lh-muted" style={styles.assessNote}>
            The source published too little about this listing to score it honestly. It is listed,
            not hidden.
          </p>
        )}
        {expanded && (
          <div style={styles.reasonBlock}>
            {job.leadReasons.length > 0 && (
              <ul style={styles.reasonList}>
                {job.leadReasons.map((r, i) => (
                  <li key={`r${i}`} style={styles.reasonItem} className="lh-body">
                    <span aria-hidden="true" style={{ ...styles.reasonMark, color: '#16a34a' }}>+</span>{r}
                  </li>
                ))}
              </ul>
            )}
            {job.leadRisks.length > 0 && (
              <ul style={styles.reasonList}>
                {job.leadRisks.map((r, i) => (
                  <li key={`k${i}`} style={styles.reasonItem} className="lh-body">
                    <span aria-hidden="true" style={{ ...styles.reasonMark, color: '#d97706' }}>−</span>{r}
                  </li>
                ))}
              </ul>
            )}
            {job.authenticitySignals.length + job.authenticityWarnings.length > 0 && (
              <div style={styles.authBlock}>
                <div className="lh-muted" style={styles.authHead}>
                  Authenticity — {AUTH_LABEL[job.authenticityStatus] || job.authenticityStatus}
                </div>
                {AUTH_MEANING[job.authenticityStatus] && (
                  <p className="lh-muted" style={styles.assessNote}>{AUTH_MEANING[job.authenticityStatus]}</p>
                )}
                <ul style={styles.reasonList}>
                  {job.authenticitySignals.map(c => (
                    <li key={`s${c}`} style={styles.reasonItem} className="lh-body">
                      <span aria-hidden="true" style={{ ...styles.reasonMark, color: '#16a34a' }}>+</span>{codeLabel(c)}
                    </li>
                  ))}
                  {job.authenticityWarnings.map(c => (
                    <li key={`w${c}`} style={styles.reasonItem} className="lh-body">
                      <span aria-hidden="true" style={{ ...styles.reasonMark, color: '#d97706' }}>−</span>{codeLabel(c)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="lh-body" style={styles.snippet}>
        {job.description ? `${job.description.slice(0, 150)}${job.description.length > 150 ? '…' : ''}` : 'No description published by the source.'}
      </p>

      {/* Competition — always through competition.label, which states when the
          figure was taken. A stale reading is visually marked as one. */}
      <div
        style={{
          ...styles.competition,
          borderStyle: job.competition.outdated ? 'dashed' : 'solid',
          borderColor: job.competition.outdated ? '#fbbf24' : '#e2e8f0',
        }}
        className="lh-signal"
      >
        <span className="lh-muted" style={styles.compKey}>Competition</span>
        <span className="lh-body" style={styles.compVal}>{job.competition.label}</span>
        {job.competition.outdated && (
          <span style={styles.compFlag}>snapshot</span>
        )}
      </div>

      <div style={styles.metaRow}>
        <div style={styles.metaCell}>
          <div className="lh-muted" style={styles.metaKey}>Budget</div>
          <div className="lh-h" style={styles.metaVal}>{job.budget || 'Not stated'}</div>
        </div>
        {job.budgetType && (
          <div style={styles.metaCell}>
            <div className="lh-muted" style={styles.metaKey}>Type</div>
            <div className="lh-h" style={styles.metaVal}>{job.budgetType}</div>
          </div>
        )}
        {(job.connections ?? 0) > 0 && (
          <div style={styles.metaCell}>
            <div className="lh-muted" style={styles.metaKey}>Bid cost</div>
            <div className="lh-h" style={styles.metaVal}>{job.connections} connects</div>
          </div>
        )}
        {job.country && (
          <div style={styles.metaCell}>
            <div className="lh-muted" style={styles.metaKey}>Location</div>
            <div className="lh-h" style={{ ...styles.metaVal, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <IconMapPin size={12} />{job.country}
            </div>
          </div>
        )}
      </div>

      {/* Status strip: what this system concluded, stated as its conclusion. */}
      <div style={styles.statusStrip}>
        <span style={{ ...styles.statusChip, color: authColor, borderColor: authColor }} className="lh-signal" title={AUTH_MEANING[job.authenticityStatus] || ''}>
          {AUTH_LABEL[job.authenticityStatus] || job.authenticityStatus}
        </span>
        <span style={{ ...styles.statusChip, color: '#475569' }} className="lh-signal lh-muted">
          {FRESHNESS_LABEL[job.freshnessState] || job.freshnessState}
        </span>
        {view === 'latest' && job.freshnessState === 'unknown' && (
          <span className="lh-muted" style={{ fontSize: 11 }}>sorted last — age unknown</span>
        )}
      </div>

      {dupLabel && (
        <p className="lh-muted" style={styles.dupNote}>
          {dupLabel}
          {job.clusterSize && job.clusterSize > 1 ? ` — one of ${job.clusterSize} closely matching listings.` : '.'}
          {job.duplicateStatus === 'canonical' && job.canonicalReason ? ` Chosen as the primary by: ${job.canonicalReason}.` : ''}
          {job.duplicateStatus === 'possible_duplicate' ? ' Kept visible because the match is not certain.' : ''}
        </p>
      )}

      <div style={styles.cardActions}>
        <button onClick={onOpen} style={styles.btnPrimary}>Open details</button>
      </div>
    </article>
  );
}

/* ── Filter primitives ───────────────────────────────────────────── */
function FilterGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={styles.filterRow}>
      <span className="lh-muted" style={styles.filterLabel}>{label}</span>
      <div style={styles.filterOptions}>{children}</div>
      {hint && <span className="lh-muted" style={styles.groupHint}>{hint}</span>}
    </div>
  );
}

function Pill({ label, count, color = '#2563eb', active, onClick }: {
  label: string;
  count?: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  // No theme class while active: .lh-field's dark-mode !important background
  // would erase the option's own colour, and that colour is the legend.
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={active ? undefined : 'lh-field'}
      style={{
        ...styles.pill,
        background: active ? color : '#f1f5f9',
        color: active ? '#fff' : '#475569',
        borderColor: active ? color : '#e2e8f0',
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span style={{ ...styles.pillCount, background: active ? 'rgba(255,255,255,0.22)' : '#e2e8f0', color: active ? '#fff' : '#64748b' }}>
          {count}
        </span>
      )}
    </button>
  );
}

/* ── STYLES ─────────────────────────────────────────────────────────
   Inline-style objects plus the lh-* class hooks, matching the rest of the
   app: globals.css themes every lh-* hook for dark mode. */
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f6f8fb', color: '#111827', padding: '24px 16px' },
  shell: { maxWidth: 1320, margin: '0 auto' },

  splashLoad: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#f6f8fb',
  },
  spinner: {
    width: 36, height: 36, border: '3px solid #dbeafe', borderTopColor: '#2563eb',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },

  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    gap: 16, marginBottom: 18, flexWrap: 'wrap',
  },
  brand: { fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.025em' },
  brandSub: { fontSize: 12.5, margin: '2px 0 0', fontWeight: 600, letterSpacing: '0.01em' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btnInner: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  btnPrimary: {
    background: '#1d4ed8', color: '#fff', border: '1px solid #1d4ed8',
    borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  btnGhost: {
    background: '#fff', color: '#475569',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 8, padding: '9px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  btnAccent: {
    background: '#15803d', color: '#fff', border: '1px solid #15803d',
    borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },

  provenance: {
    background: '#fff', borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 10, padding: '12px 16px', marginBottom: 16,
    display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 28px',
  },
  provItem: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 130 },
  provKey: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  provVal: { fontSize: 14, fontWeight: 700, color: '#0f172a' },
  provNote: { flex: '1 1 320px', fontSize: 11.5, lineHeight: 1.6, margin: 0, minWidth: 0 },

  viewBlock: { marginBottom: 16 },
  tablist: { display: 'inline-flex', gap: 6, flexWrap: 'wrap' },
  tab: {
    borderWidth: '1px', borderStyle: 'solid', borderRadius: 8,
    padding: '9px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  viewExplainer: { fontSize: 12.5, lineHeight: 1.6, margin: '10px 0 0', maxWidth: 780 },
  srOnly: {
    position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
    overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', borderWidth: 0,
  },

  filtersBox: {
    background: '#fff', borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 12, padding: '14px 16px', marginBottom: 20,
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  filterRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  filterOptions: { display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 },
  filterLabel: {
    fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '0.06em', whiteSpace: 'nowrap', minWidth: 84,
  },
  groupHint: { fontSize: 11, fontStyle: 'italic', flex: '1 1 160px', minWidth: 0 },
  searchInput: {
    flex: '1 1 240px', minWidth: 0,
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 8, padding: '9px 13px', fontSize: 13, color: '#0f172a', background: '#fff',
  },
  pill: {
    borderWidth: '1px', borderStyle: 'solid', borderRadius: 999,
    padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  pillCount: { borderRadius: 999, padding: '0 6px', fontSize: 10.5, fontWeight: 800 },
  clearBtn: {
    background: '#f1f5f9', color: '#475569',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  skillChip: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#bfdbfe',
    background: '#fff', color: '#1d4ed8',
    borderRadius: 999, padding: '4px 6px 4px 11px', fontSize: 12, fontWeight: 600,
  },
  skillX: { background: 'none', border: 'none', cursor: 'pointer', color: '#1d4ed8', fontSize: 15, lineHeight: 1, padding: '0 4px' },
  skillAdd: { display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  skillInput: {
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 8, padding: '6px 10px', fontSize: 12, width: 130, background: '#fff', color: '#0f172a',
  },
  checkRow: { display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  resultLine: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', gap: 8, borderTop: '1px solid rgba(100,116,139,0.22)', paddingTop: 10, marginTop: 2,
  },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(330px,100%),1fr))', gap: 14 },
  card: {
    background: '#fff', borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 12, padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
  },
  cardTop: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  badge: { color: '#fff', borderRadius: 5, padding: '2px 8px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.02em' },
  ageLabel: { marginLeft: 'auto', fontSize: 11, whiteSpace: 'nowrap' },
  cardTitle: { margin: 0, fontSize: 15.5, fontWeight: 700, lineHeight: 1.35 },
  titleBtn: {
    background: 'none', border: 'none', padding: 0, margin: 0, textAlign: 'left',
    font: 'inherit', color: '#0f172a', cursor: 'pointer', textDecoration: 'none',
    overflowWrap: 'anywhere',
  },

  assessment: {
    borderLeftWidth: 3, borderLeftStyle: 'solid', paddingLeft: 10,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  assessTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  bandLabel: {
    fontSize: 12, fontWeight: 800, letterSpacing: '0.01em', color: '#fff',
    borderRadius: 5, padding: '3px 9px',
  },
  scoreNum: { fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  whyBtn: {
    background: '#f1f5f9', color: '#334155',
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  },
  assessNote: { fontSize: 11.5, lineHeight: 1.55, margin: 0 },
  reasonBlock: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 },
  reasonList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  reasonItem: { fontSize: 12, lineHeight: 1.5, display: 'flex', gap: 6, overflowWrap: 'anywhere' },
  reasonMark: { fontWeight: 800, flexShrink: 0 },
  authBlock: { borderTop: '1px solid rgba(100,116,139,0.22)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 },
  authHead: { fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' },

  snippet: { fontSize: 12.5, lineHeight: 1.55, margin: 0, overflowWrap: 'anywhere' },

  competition: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    borderWidth: '1px', background: '#fff', borderRadius: 8, padding: '7px 10px',
  },
  compKey: { fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' },
  compVal: { fontSize: 12, lineHeight: 1.45, flex: '1 1 140px', minWidth: 0 },
  compFlag: {
    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
    color: '#92400e', background: '#fef3c7', borderRadius: 4, padding: '1px 6px',
  },

  metaRow: { display: 'flex', flexWrap: 'wrap', gap: '8px 18px' },
  metaCell: { minWidth: 0 },
  metaKey: { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 1 },
  metaVal: { fontSize: 13, fontWeight: 700, color: '#0f172a', overflowWrap: 'anywhere' },

  statusStrip: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  statusChip: {
    fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0', background: '#fff',
  },
  dupNote: { fontSize: 11.5, lineHeight: 1.5, margin: 0, overflowWrap: 'anywhere' },
  cardActions: { display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 2 },

  stateBox: {
    background: '#fff', borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    borderRadius: 12, padding: '40px 24px', textAlign: 'center',
  },
  stateTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 8px', color: '#0f172a' },
  stateBody: { fontSize: 13.5, lineHeight: 1.65, maxWidth: 520, margin: '0 auto 18px' },
  stateActions: { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' },

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 26 },
  pageBtn: {
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea', background: '#fff',
    borderRadius: 8, padding: '8px 15px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#334155',
  },

  footer: {
    marginTop: 44, paddingTop: 20, borderTop: '1px solid rgba(100,116,139,0.28)',
    textAlign: 'center', fontSize: 13, lineHeight: 1.6,
  },
};
