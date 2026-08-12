'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, isAdmin, logout, trackActivity } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { IconTrend, IconShield, IconMapPin } from '@/components/icons';
import { timeAgo } from '@/lib/format';

const FILTERS_KEY = 'lh_jobs_filters';

type PlatformScope = 'all' | 'Upwork' | 'Freelancer';
type Tier = 'all' | 'high' | 'medium' | 'low';
type Bucket = 'all' | 'low' | 'med' | 'high';

interface FilterState {
  platform: PlatformScope;
  statusFilter: 'all' | 'new' | 'viewed' | 'applied' | 'hot';
  countryFilter: string;
  scoreFilter: Tier;
  jobTypeFilter: 'all' | 'fixed' | 'hourly';
  experienceFilter: string;
  skillsFilter: string[];
  competitionFilter: Bucket;
  connectsFilter: Bucket;
  postedFilter: 'all' | '24h' | '3d' | '7d';
  search: string;
  smartActive: boolean;
  smartKeyword: string;
  smartMaxBid: number | null;
  nowMs: number;
}

const DEFAULT_FILTERS: FilterState = {
  platform: 'Upwork',
  statusFilter: 'all',
  countryFilter: 'All',
  scoreFilter: 'all',
  jobTypeFilter: 'all',
  experienceFilter: 'all',
  skillsFilter: [],
  competitionFilter: 'all',
  connectsFilter: 'all',
  postedFilter: 'all',
  search: '',
  smartActive: false,
  smartKeyword: '',
  smartMaxBid: null,
  nowMs: 0,
};

function loadFilters(): FilterState {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    return { ...DEFAULT_FILTERS, ...parsed };
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

function scoreTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}
function compBucket(n: number | null | undefined): 'low' | 'med' | 'high' | null {
  if (typeof n !== 'number') return null;
  if (n <= 5) return 'low';
  if (n <= 20) return 'med';
  return 'high';
}
function connBucket(n: number | undefined): 'low' | 'med' | 'high' {
  const v = n ?? 0;
  if (v <= 5) return 'low';
  if (v <= 12) return 'med';
  return 'high';
}

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

/**
 * Default "Recommended" ranking (also used by the explicit "Lowest proposals"
 * sort). Deterministic priority:
 *   1. Lowest KNOWN competition first; unknown competition last.
 *   2. Stronger opportunity score.
 *   3. Fresher posting.
 *   4. Act-fast signal.
 *   5. Healthier budget.
 *   6. Repeat-client signal.
 *   7. Stable job-id tie-breaker (no randomness / insertion order).
 */
function recommendedComparator(a: Job, b: Job): number {
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
const POSTED_HOURS: Record<string, number> = { '24h': 24, '3d': 72, '7d': 168 };

/**
 * Single source of truth for filtering. Applies every active filter to a job.
 * `except` lets the faceted-count pass ignore one dimension so option counts
 * reflect "all other filters applied". Platform scope is applied separately
 * (the platform selector defines the dataset, it is not a facet).
 */
function passes(f: FilterState, job: Job, except?: string): boolean {
  if (except !== 'status') {
    if (f.statusFilter === 'new' && !( !job.viewed && !job.applied)) return false;
    if (f.statusFilter === 'viewed' && !( job.viewed && !job.applied)) return false;
    if (f.statusFilter === 'applied' && !job.applied) return false;
    if (f.statusFilter === 'hot' && !(job.score >= 70)) return false;
  }
  if (except !== 'country') {
    if (f.countryFilter !== 'All' && (job.country || '') !== f.countryFilter) return false;
  }
  if (except !== 'experience') {
    if (f.experienceFilter !== 'all' && (job.experienceLevel || '') !== f.experienceFilter) return false;
  }
  if (except !== 'skills') {
    if (f.skillsFilter.length && !(job.skills || []).some(s => f.skillsFilter.includes(s))) return false;
  }
  if (except !== 'jobType') {
    if (f.jobTypeFilter !== 'all') {
      const bt = (job.budgetType || '').toLowerCase();
      if (f.jobTypeFilter === 'fixed' && !bt.includes('fixed')) return false;
      if (f.jobTypeFilter === 'hourly' && !bt.includes('hourly')) return false;
    }
  }
  if (except !== 'competition') {
    if (f.competitionFilter !== 'all' && compBucket(job.proposalCount) !== f.competitionFilter) return false;
  }
  if (except !== 'connects') {
    if (f.connectsFilter !== 'all' && connBucket(job.connections) !== f.connectsFilter) return false;
  }
  if (except !== 'score') {
    if (f.scoreFilter !== 'all' && scoreTier(job.score) !== f.scoreFilter) return false;
  }
  if (except !== 'posted') {
    if (f.postedFilter !== 'all') {
      if (!job.postedAt) return false;
      const cutoff = f.nowMs - POSTED_HOURS[f.postedFilter] * 3600000;
      const t = new Date(job.postedAt).getTime();
      if (!Number.isFinite(t) || t < cutoff) return false;
    }
  }
  if (except !== 'search') {
    const q = (f.smartActive ? f.smartKeyword : f.search).trim().toLowerCase();
    if (q && !`${job.title} ${job.description} ${job.platform} ${job.clientName || ''} ${job.country || ''}`.toLowerCase().includes(q)) return false;
    if (f.smartMaxBid != null) {
      const m = job.budget.match(/\$?([\d,]+)/);
      if (m && parseInt(m[1].replace(',', ''), 10) > f.smartMaxBid) return false;
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

  // Filters — restored from per-tab sessionStorage; a completely new session
  // defaults to Upwork only (not overwritten by async job fetching).
  const [platform, setPlatform] = useState<PlatformScope>(() => loadFilters().platform);
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'viewed' | 'applied' | 'hot'>(() => loadFilters().statusFilter);
  const [countryFilter, setCountryFilter] = useState(() => loadFilters().countryFilter);
  const [scoreFilter, setScoreFilter] = useState<Tier>(() => loadFilters().scoreFilter);
  const [jobTypeFilter, setJobTypeFilter] = useState<'all' | 'fixed' | 'hourly'>(() => loadFilters().jobTypeFilter);
  const [experienceFilter, setExperienceFilter] = useState(() => loadFilters().experienceFilter);
  const [skillsFilter, setSkillsFilter] = useState<string[]>(() => loadFilters().skillsFilter);
  const [competitionFilter, setCompetitionFilter] = useState<Bucket>(() => loadFilters().competitionFilter);
  const [connectsFilter, setConnectsFilter] = useState<Bucket>(() => loadFilters().connectsFilter);
  const [postedFilter, setPostedFilter] = useState<'all' | '24h' | '3d' | '7d'>(() => loadFilters().postedFilter);
  const [search, setSearch] = useState(() => loadFilters().search);
  const [smartActive, setSmartActive] = useState(() => loadFilters().smartActive);
  const [smartRaw, setSmartRaw] = useState(() => loadFilters().smartKeyword);
  const [smartKeyword, setSmartKeyword] = useState(() => loadFilters().smartKeyword);
  const [smartMaxBid, setSmartMaxBid] = useState<number | null>(() => loadFilters().smartMaxBid);
  const [sortBy, setSortBy] = useState<'score' | 'date' | 'budget' | 'recommended' | 'proposals'>(() => 'recommended');
  const [page, setPage] = useState(1);

  // Search state: `search` is the natural-language box; when a query is
  // parsed into filters we keep the raw text for the active chip and use the
  // stripped `smartKeyword` for the actual keyword filter.
  const [searchFocus, setSearchFocus] = useState(false);

  // Current time kept in state (refreshed every minute) so "posted within"
  // filtering stays pure during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Persist filter state across navigation/refresh (per-tab sessionStorage).
  useEffect(() => {
    saveFilters({ platform, statusFilter, countryFilter, scoreFilter, jobTypeFilter, experienceFilter, skillsFilter, competitionFilter, connectsFilter, postedFilter, search, smartActive, smartKeyword, smartMaxBid, nowMs });
  }, [platform, statusFilter, countryFilter, scoreFilter, jobTypeFilter, experienceFilter, skillsFilter, competitionFilter, connectsFilter, postedFilter, search, smartActive, smartKeyword, smartMaxBid, nowMs]);

  const PER_PAGE = 24;

  // Both platforms we support, always offered as selectors even if the current
  // dataset is thin for one of them (so the structure is predictable).
  const PLATFORM_OPTIONS: PlatformScope[] = ['all', 'Upwork', 'Freelancer'];

  // Platform scope = the dataset the filters operate on.
  const scopeJobs = useMemo(
    () => (platform === 'all' ? jobs : jobs.filter(j => j.platform === platform)),
    [jobs, platform]
  );

  const hasCompetitionData = useMemo(() => scopeJobs.some(j => typeof j.proposalCount === 'number'), [scopeJobs]);
  const showConnects = platform !== 'Freelancer';

  // Dynamic options — derived ONLY from real jobs in the current platform scope.
  const experienceOptions = useMemo(
    () => Array.from(new Set(scopeJobs.map(j => j.experienceLevel || '').filter(Boolean))).sort(),
    [scopeJobs]
  );
  const skillOptions = useMemo(() => {
    const m = new Map<string, number>();
    scopeJobs.forEach(j => (j.skills || []).forEach(s => m.set(s, (m.get(s) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([s]) => s);
  }, [scopeJobs]);
  const countryOptions = useMemo(() => {
    const cs = scopeJobs.map(j => j.country || '').filter(c => Boolean(c) && c.toLowerCase() !== 'remote');
    return ['All', ...Array.from(new Set(cs)).sort()];
  }, [scopeJobs]);
  const hasFixed = useMemo(() => scopeJobs.some(j => (j.budgetType || '').toLowerCase().includes('fixed')), [scopeJobs]);
  const hasHourly = useMemo(() => scopeJobs.some(j => (j.budgetType || '').toLowerCase().includes('hourly')), [scopeJobs]);

  // Competition label follows each platform's real terminology (rule 6).
  const competitionLabel = platform === 'Upwork' ? 'Proposals' : platform === 'Freelancer' ? 'Bids' : 'Proposals / Bids';

  // Bundle the active filters so the pure filter/count helpers can read them.
  const f = useMemo<FilterState>(
    () => ({ platform, statusFilter, countryFilter, scoreFilter, jobTypeFilter, experienceFilter, skillsFilter, competitionFilter, connectsFilter, postedFilter, search, smartActive, smartKeyword, smartMaxBid, nowMs }),
    [platform, statusFilter, countryFilter, scoreFilter, jobTypeFilter, experienceFilter, skillsFilter, competitionFilter, connectsFilter, postedFilter, search, smartActive, smartKeyword, smartMaxBid, nowMs]
  );

  const stats = useMemo(() => ({
    total: jobs.length,
    new: jobs.filter(j => !j.viewed && !j.applied).length,
    hot: jobs.filter(j => j.score >= 70).length,
    applied: jobs.filter(j => j.applied).length,
  }), [jobs]);

  // Search suggestions built from the real data (platforms, countries, skills)
  // plus a few canned time/type intents.
  const searchSuggestions = useMemo(() => {
    const skills = new Set<string>();
    jobs.forEach(j => (j.skills ?? []).forEach(s => { const low = s.toLowerCase(); if (low.length >= 2) skills.add(low); }));
    const countries = new Set(jobs.map(j => j.country).filter(Boolean));
    const base: string[] = ['last 24 hours', 'last 3 days', 'last 7 days', 'hourly', 'fixed', 'high score', 'review'];
    base.push('upwork', 'freelancer');
    countries.forEach(c => base.push(`${String(c).toLowerCase()} jobs`));
    base.push(...[...skills].slice(0, 10));
    return [...new Set(base)].slice(0, 16);
  }, [jobs]);

  const visibleSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return searchSuggestions.slice(0, 6);
    return searchSuggestions.filter(s => s.includes(q)).slice(0, 6);
  }, [search, searchSuggestions]);

  // Faceted counts — every option count is recomputed from jobs that match all
  // OTHER active filters, so counts stay honest as the user changes anything.
  const facets = useMemo(() => {
    const countExcept = (except: string, pred: (j: Job) => boolean) =>
      scopeJobs.filter(j => passes(f, j, except) && pred(j)).length;

    const tiers = {
      all: countExcept('score', () => true),
      high: countExcept('score', j => scoreTier(j.score) === 'high'),
      medium: countExcept('score', j => scoreTier(j.score) === 'medium'),
      low: countExcept('score', j => scoreTier(j.score) === 'low'),
    };
    const countries: Record<string, number> = {};
    countryOptions.filter(c => c !== 'All').forEach(c => { countries[c] = countExcept('country', j => (j.country || '') === c); });
    const experiences: Record<string, number> = {};
    experienceOptions.forEach(e => { experiences[e] = countExcept('experience', j => (j.experienceLevel || '') === e); });
    const skills: Record<string, number> = {};
    skillOptions.forEach(s => { skills[s] = countExcept('skills', j => (j.skills || []).includes(s)); });

    const jobType = {
      fixed: hasFixed ? countExcept('jobType', j => (j.budgetType || '').toLowerCase().includes('fixed')) : 0,
      hourly: hasHourly ? countExcept('jobType', j => (j.budgetType || '').toLowerCase().includes('hourly')) : 0,
    };

    const competition: Record<string, number> = {};
    if (hasCompetitionData) {
      (['low', 'med', 'high'] as const).forEach(b => {
        competition[b] = countExcept('competition', j => compBucket(j.proposalCount) === b);
      });
    }
    const connects: Record<string, number> = {};
    if (showConnects) {
      (['low', 'med', 'high'] as const).forEach(b => {
        connects[b] = countExcept('connects', j => connBucket(j.connections) === b);
      });
    }

    return { tiers, countries, experiences, skills, jobType, competition, connects };
  }, [scopeJobs, f, countryOptions, experienceOptions, skillOptions, hasFixed, hasHourly, hasCompetitionData, showConnects]);

  const filteredJobs = useMemo(() => {
    const result = scopeJobs.filter(j => passes(f, j));

    if (sortBy === 'recommended' || sortBy === 'proposals') {
      result.sort(recommendedComparator);
    } else if (sortBy === 'score') {
      result.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const tb = postedTimeOf(b) - postedTimeOf(a);
        if (tb !== 0) return tb;
        const pa = a.proposalCount ?? Number.MAX_SAFE_INTEGER;
        const pb = b.proposalCount ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return budgetNumber(b.budget) - budgetNumber(a.budget);
      });
    } else if (sortBy === 'date') result.sort((a, b) => postedTimeOf(b) - postedTimeOf(a));
    else if (sortBy === 'budget') result.sort((a, b) => budgetNumber(b.budget) - budgetNumber(a.budget));

    // Push applied jobs to the very end (bottom) unless user is explicitly on the 'Applied' filter tab.
    // Stable sort preserves the primary ranking among non-applied jobs.
    if (statusFilter !== 'applied') {
      result.sort((a, b) => {
        if (a.applied && !b.applied) return 1;
        if (!a.applied && b.applied) return -1;
        return 0;
      });
    }
    return result;
  }, [scopeJobs, f, sortBy, statusFilter]);

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

  // Switching platform clears every scope-dependent selection so no Upwork-only
  // control (or stale value) leaks into a Freelancer view, and vice-versa.
  const changePlatform = (next: PlatformScope) => {
    setPlatform(next);
    setExperienceFilter('all');
    setSkillsFilter([]);
    setCountryFilter('All');
    setJobTypeFilter('all');
    setCompetitionFilter('all');
    setConnectsFilter('all');
    setPage(1);
  };

  const toggleSkill = (s: string) => {
    setSkillsFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    setPage(1);
  };

  const clearAll = () => {
    setPlatform(DEFAULT_FILTERS.platform);
    setStatusFilter('all');
    setCountryFilter('All');
    setScoreFilter('all');
    setJobTypeFilter('all');
    setExperienceFilter('all');
    setSkillsFilter([]);
    setCompetitionFilter('all');
    setConnectsFilter('all');
    setPostedFilter('all');
    setSearch('');
    setSmartActive(false);
    setSmartRaw('');
    setSmartKeyword('');
    setSmartMaxBid(null);
    setPage(1);
  };

  // Search: parse a natural-language query into whitelisted filters via
  // /api/search, apply them, and surface an active chip with the raw text.
  const applySmartSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const parsed = await res.json();
      if (parsed.platform === 'Upwork' || parsed.platform === 'Freelancer') changePlatform(parsed.platform);
      if (parsed.opportunity === 'high') setScoreFilter('high');
      else if (parsed.opportunity === 'good') setScoreFilter('medium');
      else if (parsed.opportunity === 'review') setScoreFilter('low');
      if (parsed.jobType === 'hourly' || parsed.jobType === 'fixed') setJobTypeFilter(parsed.jobType);
      if (parsed.posted) setPostedFilter(parsed.posted);
      if (parsed.country) setCountryFilter(parsed.country);
      setSmartMaxBid(parsed.maxBid ?? null);
      setSmartKeyword(parsed.query || '');
      setSmartActive(true);
      setSmartRaw(q);
      setPage(1);
      setSearchFocus(false);
    } catch {
      setSmartKeyword('');
      setSmartActive(true);
      setSmartRaw(q);
      setPage(1);
      setSearchFocus(false);
    }
  };

  const clearSmartSearch = () => {
    setSmartActive(false);
    setSmartRaw('');
    setSmartKeyword('');
    setSmartMaxBid(null);
    setSearch('');
    setScoreFilter('all');
    setJobTypeFilter('all');
    setPostedFilter('all');
    setPage(1);
  };

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (smartActive) {
      setSmartActive(false);
      setSmartKeyword('');
      setSmartRaw('');
      setSmartMaxBid(null);
    }
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
    statusFilter !== 'all' || countryFilter !== 'All' || scoreFilter !== 'all' || jobTypeFilter !== 'all' ||
    experienceFilter !== 'all' || skillsFilter.length > 0 || competitionFilter !== 'all' || connectsFilter !== 'all' ||
    postedFilter !== 'all' || smartActive || search.trim() !== '';

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
            <button onClick={() => { setNewCount(0); setStatusFilter('new'); }} style={styles.bannerBtn}>View New</button>
          </div>
        )}

        {/* ── STATS ── */}
        <div style={styles.statsRow}>
          {[
            { label: 'Total', value: stats.total, key: 'all' as const },
            { label: 'New', value: stats.new, key: 'new' as const },
            { label: 'Hot (70+)', value: stats.hot, key: 'hot' as const },
            { label: 'Applied', value: stats.applied, key: 'applied' as const },
          ].map(s => (
            <button
              key={s.key}
              className="lh-surface"
              onClick={() => { setStatusFilter(prev => prev === s.key ? 'all' : s.key); setPage(1); }}
              style={{
                ...styles.statCard,
                borderWidth: '2px',
                borderStyle: 'solid',
                borderColor: statusFilter === s.key ? '#2563eb' : '#e2e8f0',
                boxShadow: statusFilter === s.key ? '0 0 0 3px rgba(37,99,235,0.12)' : '0 1px 2px rgba(15,23,42,0.04)',
              }}
            >
              <div className="lh-h" style={styles.statNum}>{s.value}</div>
              <div className="lh-muted" style={styles.statLabel}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* ── FILTERS ── */}
        <div style={styles.filtersBox} className="lh-surface">

          {/* Search + sort + posted window */}
          <div style={styles.filterRow}>
            <div style={{ position: 'relative', flex: 1, minWidth: 'min(260px,100%)' }}>
              <input
                type="text"
                className="lh-field"
                placeholder="Search — try “react jobs from the last 3 days” or “flutter por hora”…"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                onFocus={() => setSearchFocus(true)}
                onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
                onKeyDown={e => { if (e.key === 'Enter') void applySmartSearch(search); }}
                style={styles.searchInput}
                aria-label="Search jobs"
              />
              {searchFocus && visibleSuggestions.length > 0 && (
                <div style={styles.suggestBox} className="lh-surface">
                  {visibleSuggestions.map(s => (
                    <button
                      key={s}
                      type="button"
                      className="lh-field"
                      style={styles.suggestItem}
                      onMouseDown={e => { e.preventDefault(); void applySmartSearch(s); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => void applySmartSearch(search)} style={styles.btnPrimary}>
              Search
            </button>
            <select value={sortBy} onChange={e => { setSortBy(e.target.value as 'score' | 'date' | 'budget' | 'recommended' | 'proposals'); setPage(1); }} style={styles.select} className="lh-field">
              <option value="recommended">Sort: Recommended</option>
              <option value="proposals">Sort: Lowest proposals</option>
              <option value="score">Sort: Best score</option>
              <option value="date">Sort: Latest first</option>
              <option value="budget">Sort: Highest budget</option>
            </select>
            <select value={postedFilter} onChange={e => { setPostedFilter(e.target.value as 'all' | '24h' | '3d' | '7d'); setPage(1); }} style={styles.select} className="lh-field">
              <option value="all">Posted: Any time</option>
              <option value="24h">Posted: Last 24 hours</option>
              <option value="3d">Posted: Last 3 days</option>
              <option value="7d">Posted: Last 7 days</option>
            </select>
          </div>

          {/* Active search chip */}
          {smartActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={styles.smartChip} className="lh-field">
                Search: “{smartRaw}”
                <button
                  onClick={clearSmartSearch}
                  aria-label="Clear search"
                  className="lh-muted"
                  style={styles.smartChipX}
                >
                  ×
                </button>
              </span>
              {smartMaxBid != null && (
                <span style={styles.smartChip} className="lh-field">Budget ≤ ${smartMaxBid.toLocaleString()}</span>
              )}
              <span className="lh-muted" style={{ fontSize: 11.5, color: '#94a3b8' }}>
                Filters applied from your search — click × to reset.
              </span>
            </div>
          )}

          {/* Platform selector — controls the whole filter structure */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Platform:</span>
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
          </div>

          {/* Opportunity tier pills — primary filter dimension, with live counts */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Opportunity:</span>
            <FilterPill label="All" count={facets.tiers.all} active={scoreFilter === 'all'} color="#2563eb" onClick={() => { setScoreFilter('all'); setPage(1); }} />
            <FilterPill label="High" count={facets.tiers.high} active={scoreFilter === 'high'} color="#10b981" onClick={() => { setScoreFilter(prev => prev === 'high' ? 'all' : 'high'); setPage(1); }} />
            <FilterPill label="Good" count={facets.tiers.medium} active={scoreFilter === 'medium'} color="#3b82f6" onClick={() => { setScoreFilter(prev => prev === 'medium' ? 'all' : 'medium'); setPage(1); }} />
            <FilterPill label="Hot Lead" count={facets.tiers.low} active={scoreFilter === 'low'} color="#f59e0b" onClick={() => { setScoreFilter(prev => prev === 'low' ? 'all' : 'low'); setPage(1); }} />
          </div>

          {/* Job type (Fixed / Hourly) — shared concept, both platforms */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Budget Type:</span>
            <select value={jobTypeFilter} onChange={e => { setJobTypeFilter(e.target.value as 'all' | 'fixed' | 'hourly'); setPage(1); }} style={styles.select} className="lh-field">
              <option value="all">Any Budget Type</option>
              {hasFixed && <option value="fixed">Fixed Price ({facets.jobType.fixed})</option>}
              {hasHourly && <option value="hourly">Hourly Rate ({facets.jobType.hourly})</option>}
            </select>

            <span className="lh-muted" style={styles.filterLabel}>Country:</span>
            <select value={countryFilter} onChange={e => { setCountryFilter(e.target.value); setPage(1); }} style={styles.select} className="lh-field">
              {countryOptions.map(c => <option key={c} value={c}>{c === 'All' ? 'All' : `${c} (${facets.countries[c] ?? 0})`}</option>)}
            </select>
          </div>

          {/* Experience level — dynamic from real values in the platform scope */}
          {experienceOptions.length > 0 && (
            <div style={styles.filterRow}>
              <span className="lh-muted" style={styles.filterLabel}>Experience:</span>
              <FilterPill label="All" count={facets.tiers.all} active={experienceFilter === 'all'} color="#0f172a" onClick={() => { setExperienceFilter('all'); setPage(1); }} />
              {experienceOptions.map(e => (
                <FilterPill
                  key={e}
                  label={e}
                  count={facets.experiences[e] ?? 0}
                  active={experienceFilter === e}
                  color="#7c3aed"
                  onClick={() => { setExperienceFilter(prev => prev === e ? 'all' : e); setPage(1); }}
                />
              ))}
            </div>
          )}

          {/* Competition — labelled per platform (Proposals / Bids) */}
          {hasCompetitionData && (
            <div style={styles.filterRow}>
              <span className="lh-muted" style={styles.filterLabel}>{competitionLabel}:</span>
              <FilterPill label="Any" count={facets.tiers.all} active={competitionFilter === 'all'} color="#0f172a" onClick={() => { setCompetitionFilter('all'); setPage(1); }} />
              {(['low', 'med', 'high'] as const).map(b => (
                <FilterPill
                  key={b}
                  label={b === 'low' ? 'Low (≤5)' : b === 'med' ? 'Medium (6–20)' : 'High (20+)'}
                  count={facets.competition[b] ?? 0}
                  active={competitionFilter === b}
                  color="#b45309"
                  onClick={() => { setCompetitionFilter(prev => prev === b ? 'all' : b); setPage(1); }}
                />
              ))}
            </div>
          )}

          {/* Connects / Bid Cost — Upwork only (Freelancer has no connects) */}
          {showConnects && (
            <div style={styles.filterRow}>
              <span className="lh-muted" style={styles.filterLabel}>Connects:</span>
              <FilterPill label="Any" count={facets.tiers.all} active={connectsFilter === 'all'} color="#0f172a" onClick={() => { setConnectsFilter('all'); setPage(1); }} />
              {(['low', 'med', 'high'] as const).map(b => (
                <FilterPill
                  key={b}
                  label={b === 'low' ? 'Low (≤5)' : b === 'med' ? 'Medium (6–12)' : 'High (13+)'}
                  count={facets.connects[b] ?? 0}
                  active={connectsFilter === b}
                  color="#2563eb"
                  onClick={() => { setConnectsFilter(prev => prev === b ? 'all' : b); setPage(1); }}
                />
              ))}
            </div>
          )}

          {/* Skills — dynamic, multi-select, from real skills in the scope */}
          {skillOptions.length > 0 && (
            <div style={{ ...styles.filterRow, alignItems: 'flex-start' }}>
              <span className="lh-muted" style={styles.filterLabel}>Skills:</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                {skillOptions.map(s => {
                  const active = skillsFilter.includes(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSkill(s)}
                      className={active ? undefined : 'lh-field'}
                      style={{
                        ...styles.skillChip,
                        background: active ? '#2563eb' : '#f1f5f9',
                        color: active ? '#fff' : '#475569',
                        borderColor: active ? '#2563eb' : '#e2e8f0',
                      }}
                    >
                      {s}
                      <span style={{ ...styles.skillCount, color: active ? 'rgba(255,255,255,0.8)' : '#94a3b8' }}>{facets.skills[s] ?? 0}</span>
                    </button>
                  );
                })}
                {skillsFilter.length > 0 && (
                  <button onClick={() => { setSkillsFilter([]); setPage(1); }} className="lh-muted" style={styles.clearChip}>Clear skills</button>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="lh-muted" style={{ fontSize: 12, color: '#94a3b8' }}>
              Showing {Math.min((page - 1) * PER_PAGE + 1, filteredJobs.length)}–{Math.min(page * PER_PAGE, filteredJobs.length)} of {filteredJobs.length} jobs{filteredJobs.length !== scopeJobs.length ? ` (from ${scopeJobs.length} in ${platform === 'all' ? 'all platforms' : platform})` : ''}
            </div>
            {anyFilterActive && (
              <button onClick={clearAll} style={styles.clearBtn}>Clear all filters</button>
            )}
          </div>
        </div>

        {/* ── JOB GRID ── */}
        {paginatedJobs.length === 0 ? (
          <div style={styles.emptyBox} className="lh-surface">
            <p className="lh-h" style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>No jobs match these filters</p>
            <p className="lh-body" style={{ color: '#64748b', marginBottom: 16 }}>Try widening the filters or clearing them, then run a fresh sync.</p>
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
                     {job.score >= 70 && <span style={{ ...styles.badge, background: '#f59e0b' }}>Hot</span>}
                     {job.score >= 70 && !job.applied && <span style={{ ...styles.badge, background: '#16a34a' }}>Suggested</span>}
                    {typeof job.proposalCount === 'number' && job.proposalCount === 0 && <span style={{ ...styles.badge, background: '#16a34a' }}>No competition</span>}
                    {typeof job.proposalCount === 'number' && job.proposalCount > 0 && job.proposalCount <= 5 && <span style={{ ...styles.badge, background: '#16a34a' }}>Low competition</span>}
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
