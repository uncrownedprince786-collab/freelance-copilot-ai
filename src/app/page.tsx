'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, isAdmin, logout, trackActivity } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { IconTrend, IconShield, IconMapPin } from '@/components/icons';
import { timeAgo } from '@/lib/format';

const FILTERS_KEY = 'lh_jobs_filters';

interface JobsFilters {
  search: string;
  platformFilter: string[];
  statusFilter: 'all' | 'new' | 'viewed' | 'applied' | 'hot';
  countryFilter: string;
  connectionsFilter: string;
  scoreFilter: 'all' | 'high' | 'medium' | 'low';
  jobTypeFilter: 'all' | 'fixed' | 'hourly';
  postedFilter: 'all' | '24h' | '3d' | '7d';
  sortBy: 'score' | 'date' | 'budget';
}

// Per-tab session defaults. A brand-new session defaults to Upwork only and
// score-first ranking (best opportunities rise to the top).
const DEFAULT_FILTERS: JobsFilters = {
  search: '',
  platformFilter: ['Upwork'],
  statusFilter: 'all',
  countryFilter: 'All',
  connectionsFilter: 'all',
  scoreFilter: 'all',
  jobTypeFilter: 'all',
  postedFilter: 'all',
  sortBy: 'score',
};

function loadFilters(): JobsFilters {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<JobsFilters>;
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(f: JobsFilters) {
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
  const [showIntroPopup, setShowIntroPopup] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncSchedule, setSyncSchedule] = useState('');

  const [authed, setAuthed] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = sessionStorage.getItem('hideLeadHunterIntroSession');
      if (dismissed === 'true') {
        setShowIntroPopup(false);
      }
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


  const closeIntroPopup = () => {
    setShowIntroPopup(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('hideLeadHunterIntroSession', 'true');
    }
  };

  // Filters — restored from per-tab sessionStorage; a completely new session
  // defaults to Upwork only (not overwritten by async job fetching).
  const [search, setSearch] = useState(() => loadFilters().search);
  const [platformFilter, setPlatformFilter] = useState<string[]>(() => loadFilters().platformFilter);
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'viewed' | 'applied' | 'hot'>(() => loadFilters().statusFilter);
  const [countryFilter, setCountryFilter] = useState(() => loadFilters().countryFilter);
  const [connectionsFilter, setConnectionsFilter] = useState(() => loadFilters().connectionsFilter);
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'medium' | 'low'>(() => loadFilters().scoreFilter);
  const [jobTypeFilter, setJobTypeFilter] = useState<'all' | 'fixed' | 'hourly'>(() => loadFilters().jobTypeFilter);
  const [postedFilter, setPostedFilter] = useState<'all' | '24h' | '3d' | '7d'>(() => loadFilters().postedFilter);
  const [sortBy, setSortBy] = useState<'score' | 'date' | 'budget'>(() => loadFilters().sortBy);
  const [page, setPage] = useState(1);

  // Smart search state: `search` is the natural-language box; when a query is
  // parsed into filters we keep the raw text for the active chip and use the
  // stripped `smartKeyword` for the actual keyword filter.
  const [smartActive, setSmartActive] = useState(false);
  const [smartRaw, setSmartRaw] = useState('');
  const [smartKeyword, setSmartKeyword] = useState('');
  const [smartMaxBid, setSmartMaxBid] = useState<number | null>(null);
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
    saveFilters({ search, platformFilter, statusFilter, countryFilter, connectionsFilter, scoreFilter, jobTypeFilter, postedFilter, sortBy });
  }, [search, platformFilter, statusFilter, countryFilter, connectionsFilter, scoreFilter, jobTypeFilter, postedFilter, sortBy]);
  const PER_PAGE = 24;

  // Derived metadata from jobs
  const availablePlatforms = useMemo(() => [...new Set(jobs.map(j => j.platform))], [jobs]);
  const availableCountries = useMemo(() => {
    const countries = jobs
      .map(j => j.country || '')
      .filter(c => Boolean(c) && c.toLowerCase() !== 'remote');
    return ['All', ...Array.from(new Set(countries)).sort()];
  }, [jobs]);

  const stats = useMemo(() => ({
    total: jobs.length,
    new: jobs.filter(j => !j.viewed && !j.applied).length,
    hot: jobs.filter(j => j.score >= 70).length,
    applied: jobs.filter(j => j.applied).length,
  }), [jobs]);

  // Opportunity tiers (High / Good / Review) with live counts — the "primary
  // pills" dimension alongside the status stats above.
  const oppStats = useMemo(() => ({
    high: jobs.filter(j => j.score >= 70).length,
    good: jobs.filter(j => j.score >= 50 && j.score < 70).length,
    review: jobs.filter(j => j.score < 50).length,
  }), [jobs]);

  // Smart-search suggestions built from the real data (platforms, countries,
  // skills) plus a few canned time/type intents.
  const searchSuggestions = useMemo(() => {
    const skills = new Set<string>();
    jobs.forEach(j => (j.skills ?? []).forEach(s => { const low = s.toLowerCase(); if (low.length >= 2) skills.add(low); }));
    const platforms = new Set(jobs.map(j => j.platform).filter(Boolean));
    const countries = new Set(jobs.map(j => j.country).filter(Boolean));
    const base: string[] = ['last 24 hours', 'last 3 days', 'last 7 days', 'hourly', 'fixed', 'high score', 'review'];
    platforms.forEach(p => base.push(String(p).toLowerCase()));
    countries.forEach(c => base.push(`${String(c).toLowerCase()} jobs`));
    base.push(...[...skills].slice(0, 10));
    return [...new Set(base)].slice(0, 16);
  }, [jobs]);

  const visibleSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return searchSuggestions.slice(0, 6);
    return searchSuggestions.filter(s => s.includes(q)).slice(0, 6);
  }, [search, searchSuggestions]);

  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    // Status filter
    if (statusFilter === 'new') result = result.filter(j => !j.viewed && !j.applied);
    else if (statusFilter === 'viewed') result = result.filter(j => j.viewed && !j.applied);
    else if (statusFilter === 'applied') result = result.filter(j => j.applied);
    else if (statusFilter === 'hot') result = result.filter(j => j.score >= 70);

    // Platform filter
    if (platformFilter.length > 0) result = result.filter(j => platformFilter.includes(j.platform));

    // Country filter
    if (countryFilter !== 'All') result = result.filter(j => (j.country || j.location || '') === countryFilter);

    // Connections filter
    if (connectionsFilter === 'low') result = result.filter(j => (j.connections ?? 0) <= 5);
    else if (connectionsFilter === 'med') result = result.filter(j => { const c = j.connections ?? 0; return c >= 6 && c <= 12; });
    else if (connectionsFilter === 'high') result = result.filter(j => (j.connections ?? 0) >= 13);

    // Score filter
    if (scoreFilter === 'high') result = result.filter(j => j.score >= 70);
    else if (scoreFilter === 'medium') result = result.filter(j => j.score >= 50 && j.score < 70);
    else if (scoreFilter === 'low') result = result.filter(j => j.score < 50);

    // Job type (Fixed Price / Hourly Rate) — from the real budget type.
    if (jobTypeFilter === 'fixed') result = result.filter(j => (j.budgetType || '').toLowerCase().includes('fixed'));
    else if (jobTypeFilter === 'hourly') result = result.filter(j => (j.budgetType || '').toLowerCase().includes('hourly'));

    // Posted within — based on the real posting time.
    if (postedFilter !== 'all') {
      const hoursMap = { '24h': 24, '3d': 72, '7d': 168 } as const;
      const cutoff = nowMs - hoursMap[postedFilter] * 3600000;
      result = result.filter(j => {
        const t = new Date(j.postedAt || 0).getTime();
        return Number.isFinite(t) && t >= cutoff;
      });
    }

    // Smart-search budget cap ("under $500" style queries).
    if (smartMaxBid != null) {
      result = result.filter(j => {
        const m = j.budget.match(/\$?([\d,]+)/);
        return !m || parseInt(m[1].replace(',', ''), 10) <= smartMaxBid;
      });
    }

    // Search
    const q = (smartActive ? smartKeyword : search).trim().toLowerCase();
    if (q) result = result.filter(j =>
      `${j.title} ${j.description} ${j.platform} ${j.clientName || ''} ${j.country || ''}`.toLowerCase().includes(q)
    );

    // Sort — score-first ranking uses real secondary signals (posting time,
    // competition, budget) as tiebreakers so equal scores still surface the
    // freshest, least-competitive opportunities first.
    const postedTime = (j: Job) => new Date(j.postedAt || 0).getTime();
    const budgetNum = (s: string) => { const m = s.match(/\$?([\d,]+)/); return m ? parseInt(m[1].replace(',', '')) : 0; };
    if (sortBy === 'score') {
      result.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const tb = postedTime(b) - postedTime(a);
        if (tb !== 0) return tb;
        const pa = a.proposalCount ?? Number.MAX_SAFE_INTEGER;
        const pb = b.proposalCount ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return budgetNum(b.budget) - budgetNum(a.budget);
      });
    } else if (sortBy === 'date') result.sort((a, b) => postedTime(b) - postedTime(a));
    else if (sortBy === 'budget') result.sort((a, b) => budgetNum(b.budget) - budgetNum(a.budget));

    // Push applied jobs to the very end (bottom) unless user is explicitly on the 'Applied' filter tab
    if (statusFilter !== 'applied') {
      result.sort((a, b) => {
        if (a.applied && !b.applied) return 1;
        if (!a.applied && b.applied) return -1;
        return 0;
      });
    }

    return result;
  }, [jobs, statusFilter, platformFilter, countryFilter, connectionsFilter, scoreFilter, jobTypeFilter, postedFilter, search, smartKeyword, smartActive, smartMaxBid, sortBy, nowMs]);

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
        if (d?.schedule) setSyncSchedule(d.schedule);
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
    // Guests: record the view per-tab so the "Viewed" filter/badge works for
    // them too. Admins persist views server-side from the job detail page.
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
      // Re-fetch to apply correct role-based applied state
      void fetchJobs();
    }
  };

  const togglePlatform = (p: string) => {
    setPlatformFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    setPage(1);
  };

  // Smart search: parse a natural-language query into whitelisted filters via
  // /api/search, apply them, and surface an active chip with the raw text.
  const applySmartSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const parsed = await res.json();
      if (parsed.platform && availablePlatforms.includes(parsed.platform)) setPlatformFilter([parsed.platform]);
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
      // Fall back to plain keyword filtering (already live).
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
      // Editing after a parsed search drops back to live keyword filtering.
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

  return (
    <div style={styles.page} className="lh-page">
      <div style={styles.shell}>

        {/* ── WELCOME POPUP (first visit only; separate from About Us) ── */}
        {showIntroPopup && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalContent} className="lh-modal">
              <button onClick={closeIntroPopup} style={styles.modalCloseBtn}>&times;</button>
              <div style={styles.modalHeaderGroup}>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>Welcome to Lead Hunter</h2>
              </div>
              <div style={styles.modalBody}>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#2563eb', margin: '12px 0 8px', textAlign: 'center' }}>
                  Freelance job monitoring, made clear.
                </p>
                <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, textAlign: 'center' }}>
                  Lead Hunter monitors freelance job listings from Upwork and Freelancer. For each listing it shows the
                  budget, competition, and other signals available, and scores the job so you can focus on the
                  opportunities worth your time.
                </p>
              </div>
              <button onClick={closeIntroPopup} style={styles.modalActionBtn}>
                Get Started &rarr;
              </button>
            </div>
          </div>
        )}

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

        {/* ── FRESHNESS — real sync telemetry ── */}
        {lastSyncedAt && (
          <div className="lh-muted" style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
            Data last synced {timeAgo(lastSyncedAt)} &middot; adaptive sync: {syncSchedule || 'next run shortly'}
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
              onClick={() => { setStatusFilter(f => f === s.key ? 'all' : s.key); setPage(1); }}
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
          {/* Smart search + sort + posted window */}
          <div style={styles.filterRow}>
            <div style={{ position: 'relative', flex: 1, minWidth: 'min(260px,100%)' }}>
              <input
                type="text"
                className="lh-field"
                placeholder="Smart search — try “react jobs from the last 3 days” or “flutter por hora”…"
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                onFocus={() => setSearchFocus(true)}
                onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
                onKeyDown={e => { if (e.key === 'Enter') void applySmartSearch(search); }}
                style={styles.searchInput}
                aria-label="Smart search"
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
            <select value={sortBy} onChange={e => { setSortBy(e.target.value as 'score' | 'date' | 'budget'); setPage(1); }} style={styles.select} className="lh-field">
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

          {/* Active smart-search chip */}
          {smartActive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={styles.smartChip} className="lh-field">
                Smart search: “{smartRaw}”
                <button
                  onClick={clearSmartSearch}
                  aria-label="Clear smart search"
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

          {/* Opportunity tier pills — the primary filter dimension, with counts */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Opportunity:</span>
            <button
              onClick={() => { setScoreFilter('all'); setPage(1); }}
              className={scoreFilter === 'all' ? undefined : 'lh-field'}
              style={{
                ...styles.oppPill,
                background: scoreFilter === 'all' ? '#2563eb' : '#f1f5f9',
                color: scoreFilter === 'all' ? '#fff' : '#475569',
                borderColor: scoreFilter === 'all' ? '#2563eb' : '#e2e8f0',
              }}
            >
              All <span style={styles.oppCount}>{stats.total}</span>
            </button>
            <button
              onClick={() => { setScoreFilter(f => f === 'high' ? 'all' : 'high'); setPage(1); }}
              className={scoreFilter === 'high' ? undefined : 'lh-field'}
              style={{
                ...styles.oppPill,
                background: scoreFilter === 'high' ? '#10b981' : '#f1f5f9',
                color: scoreFilter === 'high' ? '#fff' : '#475569',
                borderColor: scoreFilter === 'high' ? '#10b981' : '#e2e8f0',
              }}
            >
              High <span style={styles.oppCount}>{oppStats.high}</span>
            </button>
            <button
              onClick={() => { setScoreFilter(f => f === 'medium' ? 'all' : 'medium'); setPage(1); }}
              className={scoreFilter === 'medium' ? undefined : 'lh-field'}
              style={{
                ...styles.oppPill,
                background: scoreFilter === 'medium' ? '#3b82f6' : '#f1f5f9',
                color: scoreFilter === 'medium' ? '#fff' : '#475569',
                borderColor: scoreFilter === 'medium' ? '#3b82f6' : '#e2e8f0',
              }}
            >
              Good <span style={styles.oppCount}>{oppStats.good}</span>
            </button>
            <button
              onClick={() => { setScoreFilter(f => f === 'low' ? 'all' : 'low'); setPage(1); }}
              className={scoreFilter === 'low' ? undefined : 'lh-field'}
              style={{
                ...styles.oppPill,
                background: scoreFilter === 'low' ? '#f59e0b' : '#f1f5f9',
                color: scoreFilter === 'low' ? '#fff' : '#475569',
                borderColor: scoreFilter === 'low' ? '#f59e0b' : '#e2e8f0',
              }}
            >
              Review <span style={styles.oppCount}>{oppStats.review}</span>
            </button>
          </div>

          {/* Platform toggle pills */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Platform:</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {availablePlatforms.map(p => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={platformFilter.includes(p) ? undefined : 'lh-field'}
                  style={{
                    ...styles.pill,
                    background: platformFilter.includes(p) ? (PLATFORM_COLORS[p] || '#6c5ce7') : '#f1f5f9',
                    color: platformFilter.includes(p) ? '#fff' : '#475569',
                    borderColor: platformFilter.includes(p) ? (PLATFORM_COLORS[p] || '#6c5ce7') : '#e2e8f0',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Row: Country, Bid Cost, Job Type */}
          <div style={styles.filterRow}>
            <span className="lh-muted" style={styles.filterLabel}>Country:</span>
            <select value={countryFilter} onChange={e => { setCountryFilter(e.target.value); setPage(1); }} style={styles.select} className="lh-field">
              {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <span className="lh-muted" style={styles.filterLabel}>Bid Cost:</span>
            <select value={connectionsFilter} onChange={e => { setConnectionsFilter(e.target.value); setPage(1); }} style={styles.select} className="lh-field">
              <option value="all">Any Connects</option>
              <option value="low">Low (≤5 connects)</option>
              <option value="med">Medium (6-12)</option>
              <option value="high">High (13+)</option>
            </select>

            <span className="lh-muted" style={styles.filterLabel}>Type:</span>
            <select value={jobTypeFilter} onChange={e => { setJobTypeFilter(e.target.value as 'all' | 'fixed' | 'hourly'); setPage(1); }} style={styles.select} className="lh-field">
              <option value="all">Any Budget Type</option>
              <option value="fixed">Fixed Price</option>
              <option value="hourly">Hourly Rate</option>
            </select>
          </div>

          <div className="lh-muted" style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Showing {Math.min((page - 1) * PER_PAGE + 1, filteredJobs.length)}–{Math.min(page * PER_PAGE, filteredJobs.length)} of {filteredJobs.length} jobs{filteredJobs.length !== jobs.length ? ` (filtered from ${jobs.length})` : ''}
          </div>
        </div>

        {/* ── JOB GRID ── */}
        {paginatedJobs.length === 0 ? (
          <div style={styles.emptyBox} className="lh-surface">
            <p className="lh-h" style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>No jobs match your filters</p>
            <p className="lh-body" style={{ color: '#64748b', marginBottom: 16 }}>Try widening the filters or run a fresh sync.</p>
            {adminMode && <button onClick={handleSync} style={styles.btnPrimary}>Sync Now</button>}
          </div>
        ) : (
          <div style={styles.grid}>
            {paginatedJobs.map(job => (
              <button
                key={job.id}
                type="button"
                onClick={() => handleJobClick(job)}
                style={styles.cardBtn}
              >
                <article style={styles.card} className="lh-surface">
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
                          {job.proposalCount} props
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
              </button>
            ))}
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

/* ── STYLES ─────────────────────────────────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg,#f0f4ff 0%,#f8fafc 100%)',
    color: '#111827',
    padding: '24px 16px',
    fontFamily: 'Inter,"Segoe UI",sans-serif',
  },
  shell: { maxWidth: 1320, margin: '0 auto' },

  splashLoad: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Inter,"Segoe UI",sans-serif',
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
  tagline: { color: '#64748b', fontSize: 13, marginTop: 4 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  syncBadge: {
    background: '#eff6ff', color: '#2563eb', borderRadius: 999,
    padding: '6px 12px', fontSize: 12, fontWeight: 600,
  },
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
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(15, 23, 42, 0.65)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 16
  },
  modalContent: {
    background: '#fff',
    borderRadius: 20,
    padding: '28px 32px',
    maxWidth: 480,
    width: '100%',
    position: 'relative',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    textAlign: 'center'
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 14,
    right: 18,
    background: 'none',
    border: 'none',
    fontSize: 24,
    color: '#94a3b8',
    cursor: 'pointer'
  },
  modalHeaderGroup: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  modalBody: { margin: '16px 0 24px' },
  modalActionBtn: {
    width: '100%',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '12px 24px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer'
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
    background: 'rgba(255,255,255,0.25)',
    borderRadius: 999, padding: '0 7px', fontSize: 11,
    fontWeight: 800,
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
  cardBtn: { background: 'transparent', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer' },
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