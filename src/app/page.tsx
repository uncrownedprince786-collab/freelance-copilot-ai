'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, isAdmin, logout, trackActivity } from '@/lib/auth';
import { AdminLoginModal } from '@/components/AdminLoginModal';

interface Job {
  id: string;
  title: string;
  description: string;
  url: string;
  platform: string;
  budget: string;
  budgetType: string;
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
}

const SOURCES = ['Upwork', 'Freelancer', 'Indeed', 'LinkedIn', 'Google Jobs'] as const;
const SOURCE_STORAGE_KEY = 'lh_jobs_view_state';

interface JobsViewState {
  source: string;
  keyword: string;
  workType: string;
  jobType: string;
  postedWithin: string;
  minBudget: string;
  status: string;
  country: string;
  connections: string;
  score: string;
  sortBy: string;
  page: number;
}

interface SuggestItem {
  label: string;
  source: string;
}

interface SuggestResponse {
  query: string;
  expertise: SuggestItem[];
  roles: SuggestItem[];
  related: SuggestItem[];
}

interface SmartInfo {
  query: string;
  cached: boolean;
  weak: boolean;
  quotaExhausted: boolean;
  alternatives: string[];
}

const PLATFORM_COLORS: Record<string, string> = {
  Upwork: '#14a800',
  Freelancer: '#29b2fe',
  Indeed: '#ff6b35',
  LinkedIn: '#0a66c2',
  'Google Jobs': '#34a853',
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

function timeAgo(dateStr: string) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  return `${days}d ago`;
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
  const [showIntroPopup, setShowIntroPopup] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const [authed, setAuthed] = useState(false);
  const [adminMode, setAdminMode] = useState(false);

  const closeIntroPopup = () => {
    setShowIntroPopup(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('hideLeadHunterIntroSession', 'true');
    }
  };

  const openIntroPopup = () => {
    setShowIntroPopup(true);
  };

  // Source tab (Upwork default for a new session; restored from sessionStorage after).
  const [activeSource, setActiveSource] = useState<string>('Upwork');
  // Filters
  const [keywordFilter, setKeywordFilter] = useState('');
  const [workTypeFilter, setWorkTypeFilter] = useState<string>('all');
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('all');
  const [postedWithinFilter, setPostedWithinFilter] = useState<string>('all');
  const [minBudgetFilter, setMinBudgetFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'viewed' | 'applied' | 'hot'>('all');
  const [countryFilter, setCountryFilter] = useState('All');
  const [connectionsFilter, setConnectionsFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'date' | 'budget'>('date');
  const [page, setPage] = useState(1);
  const PER_PAGE = 24;

  const saveViewState = useCallback((vs: JobsViewState) => {
    if (typeof window !== 'undefined') {
      try { sessionStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(vs)); } catch {}
    }
  }, []);

  const restoreViewState = useCallback((): JobsViewState | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(SOURCE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as JobsViewState) : null;
    } catch { return null; }
  }, []);

  const isNewSessionRef = useRef(true);

  // Restore saved view state for this browser session (sessionStorage
  // auto-clears when the tab closes, so a fresh session starts at Upwork).
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = sessionStorage.getItem('hideLeadHunterIntroSession');
      if (dismissed === 'true') {
        setShowIntroPopup(false);
      }
      setAuthed(isAuthenticated());
      setAdminMode(isAdmin());

      const saved = restoreViewState();
      if (saved) {
        isNewSessionRef.current = false;
        setActiveSource(saved.source || 'Upwork');
        setKeywordFilter(saved.keyword || '');
        setWorkTypeFilter(saved.workType || 'all');
        setJobTypeFilter(saved.jobType || 'all');
        setPostedWithinFilter(saved.postedWithin || 'all');
        setMinBudgetFilter(saved.minBudget || '');
        setStatusFilter(saved.status as 'all' | 'new' | 'viewed' | 'applied' | 'hot' || 'all');
        setCountryFilter(saved.country || 'All');
        setConnectionsFilter(saved.connections || 'all');
        setScoreFilter(saved.score as 'all' | 'high' | 'medium' | 'low' || 'all');
        setSortBy(saved.sortBy as 'score' | 'date' | 'budget' || 'date');
        setPage(saved.page || 1);
      }
    }
  }, [restoreViewState]);

  // Persist view state for the current browser session (restored on return).
  useEffect(() => {
    if (isNewSessionRef.current) return;
    saveViewState({
      source: activeSource,
      keyword: keywordFilter,
      workType: workTypeFilter,
      jobType: jobTypeFilter,
      postedWithin: postedWithinFilter,
      minBudget: minBudgetFilter,
      status: statusFilter,
      country: countryFilter,
      connections: connectionsFilter,
      score: scoreFilter,
      sortBy,
      page,
    });
  }, [activeSource, keywordFilter, workTypeFilter, jobTypeFilter, postedWithinFilter, minBudgetFilter,
      statusFilter, countryFilter, connectionsFilter, scoreFilter, sortBy, page, saveViewState]);

  // Smart search
  const [smartQuery, setSmartQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestResponse | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [smartActive, setSmartActive] = useState(false);
  const [smartInfo, setSmartInfo] = useState<SmartInfo | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [expertise, setExpertise] = useState<string[]>([]);
  const suggestSeq = useRef(0);
  const searchRef = useRef<HTMLDivElement>(null);

  // Derived metadata from jobs
  const availableCountries = useMemo(() => {
    const countries = jobs
      .map(j => j.country || j.clientName || '')
      .filter(c => Boolean(c));
    return ['All', ...Array.from(new Set(countries)).sort()];
  }, [jobs]);

  const stats = useMemo(() => ({
    total: jobs.length,
    new: jobs.filter(j => !j.viewed && !j.applied).length,
    hot: jobs.filter(j => j.score >= 70).length,
    applied: jobs.filter(j => j.applied).length,
  }), [jobs]);

  function extractBudgetNumber(budget: string): number | null {
    if (!budget) return null;
    const m = budget.match(/\$?([\d,]+(?:\.\d+)?)/);
    if (!m) return null;
    return parseFloat(m[1].replace(/,/g, ''));
  }

  function jobWorkType(job: Job): string {
    const loc = (job.country || job.location || '').toLowerCase();
    const text = ((job.title || '') + ' ' + (job.description || '')).toLowerCase();
    if (loc.includes('remote') || text.includes('remote')) return 'Remote';
    if (loc.includes('hybrid') || text.includes('hybrid')) return 'Hybrid';
    if (job.country && job.country.trim() && !loc.includes('remote')) return 'On-site';
    return 'Remote';
  }

  const filteredJobs = useMemo(() => {
    let result = [...jobs];

    // Source isolation: only the selected source tab's platform (feed mode only;
    // during an active search, show all ranked cross-source results).
    if (activeSource && !smartActive) {
      result = result.filter((j) => j.platform === activeSource);
    }

    // Keyword search across title / description / skills.
    if (keywordFilter.trim()) {
      const kw = keywordFilter.toLowerCase();
      result = result.filter((j) =>
        (j.title || '').toLowerCase().includes(kw) ||
        (j.description || '').toLowerCase().includes(kw) ||
        (Array.isArray((j as unknown as { skills?: string[] }).skills)
          ? (j as unknown as { skills?: string[] }).skills!.join(' ').toLowerCase().includes(kw)
          : false),
      );
    }

    // Work type (remote / hybrid / on-site)
    if (workTypeFilter !== 'all') result = result.filter((j) => jobWorkType(j) === workTypeFilter);

    // Job type (fixed / hourly)
    if (jobTypeFilter !== 'all') {
      result = result.filter((j) => {
        const bt = (j.budgetType || '').toLowerCase();
        if (jobTypeFilter === 'hourly') return bt.includes('hourly');
        if (jobTypeFilter === 'fixed') return bt.includes('fixed') || (!j.budgetType && j.budget.includes('$'));
        return true;
      });
    }

    // Posted date window
    if (postedWithinFilter !== 'all') {
      const days = postedWithinFilter === '24h' ? 1 : postedWithinFilter === '3d' ? 3 : postedWithinFilter === '7d' ? 7 : postedWithinFilter === '14d' ? 14 : 0;
      if (days > 0) {
        const cutoff = new Date().getTime() - days * 86400000;
        result = result.filter((j) => {
          const t = new Date(j.postedAt).getTime();
          return !isNaN(t) && t >= cutoff;
        });
      }
    }

    // Minimum budget
    if (minBudgetFilter.trim()) {
      const min = extractBudgetNumber('$' + minBudgetFilter);
      if (min) result = result.filter((j) => (extractBudgetNumber(j.budget) ?? 0) >= min);
    }

    // Status filter
    if (statusFilter === 'new') result = result.filter(j => !j.viewed && !j.applied);
    else if (statusFilter === 'viewed') result = result.filter(j => j.viewed && !j.applied);
    else if (statusFilter === 'applied') result = result.filter(j => j.applied);
    else if (statusFilter === 'hot') result = result.filter(j => j.score >= 70);

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

    // Sort
    if (sortBy === 'score') result.sort((a, b) => b.score - a.score);
    else if (sortBy === 'date') result.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
    else if (sortBy === 'budget') {
      result.sort((a, b) => {
        const extract = (s: string) => { const m = s.match(/\$?([\d,]+)/); return m ? parseInt(m[1].replace(',', '')) : 0; };
        return extract(b.budget) - extract(a.budget);
      });
    }

    // Push applied jobs to the very end (bottom) unless user is explicitly on the 'Applied' filter tab
    if (statusFilter !== 'applied') {
      result.sort((a, b) => {
        if (a.applied && !b.applied) return 1;
        if (!a.applied && b.applied) return -1;
        return 0;
      });
    }

    return result;
  }, [jobs, smartActive, activeSource, keywordFilter, workTypeFilter, jobTypeFilter, postedWithinFilter, minBudgetFilter,
      statusFilter, countryFilter, connectionsFilter, scoreFilter, sortBy]);

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
      // Guests see NO server-persisted applied state — only admin's applied list is preserved
      const role = typeof window !== 'undefined' ? sessionStorage.getItem('lh_auth_role') : null;
      const isAdminUser = role === 'admin';
      const guestApplied: Set<string> = new Set(
        JSON.parse(typeof window !== 'undefined' ? (sessionStorage.getItem('guest_applied') || '[]') : '[]')
      );
      const cleaned = data.map(j => ({
        ...j,
        applied: isAdminUser ? j.applied : guestApplied.has(j.id),
        viewed: isAdminUser ? j.viewed : false,
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

  // ── Smart search ─────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const recents = JSON.parse(sessionStorage.getItem('lh_recent_searches') || '[]');
      if (Array.isArray(recents)) setRecentSearches(recents.filter((r): r is string => typeof r === 'string').slice(0, 6));
      const skills = JSON.parse(sessionStorage.getItem('lh_profile_skills') || '[]');
      if (Array.isArray(skills)) setExpertise(skills.filter((s): s is string => typeof s === 'string').slice(0, 10));
    } catch {
      /* ignore malformed session data */
    }
  }, []);

  const fetchSuggestions = useCallback(async (value: string) => {
    const seq = ++suggestSeq.current;
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions(null);
      setSuggestOpen(false);
      setActiveIndex(-1);
      return;
    }
    try {
      const res = await fetch(
        `/api/jobs/suggest?q=${encodeURIComponent(trimmed)}&expertise=${encodeURIComponent(JSON.stringify(expertise))}`,
      );
      if (seq !== suggestSeq.current) return;
      const payload = await res.json();
      if (seq !== suggestSeq.current) return;
      setSuggestions(payload as SuggestResponse);
      setSuggestOpen(true);
      setActiveIndex(-1);
    } catch {
      if (seq === suggestSeq.current) setSuggestOpen(false);
    }
  }, [expertise]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchSuggestions(smartQuery); }, 350);
    return () => clearTimeout(timer);
  }, [smartQuery, fetchSuggestions]);

  // Close the suggestions dropdown when clicking outside the search bar.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const applyRoleState = (results: Job[]) => {
    const role = typeof window !== 'undefined' ? sessionStorage.getItem('lh_auth_role') : null;
    const isAdminUser = role === 'admin';
    const guestApplied: Set<string> = new Set(
      JSON.parse(typeof window !== 'undefined' ? (sessionStorage.getItem('guest_applied') || '[]') : '[]'),
    );
    return results.map((j) => ({
      ...j,
      applied: isAdminUser ? j.applied : guestApplied.has(j.id),
      viewed: isAdminUser ? j.viewed : false,
    }));
  };

  const runSmartSearch = async (value: string) => {
    const query = value.trim();
    if (!query) return;
    setSearching(true);
    setSuggestOpen(false);
    setSuggestions(null);
    setActiveIndex(-1);
    setSmartQuery(query);
    try {
      const res = await fetch('/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const payload = await res.json();

      if (res.status === 422) {
        setSmartActive(true);
        setSmartInfo({
          query: payload.normalized || query,
          cached: false,
          weak: true,
          quotaExhausted: false,
          alternatives: payload.alternatives || [],
        });
        setJobs([]);
        return;
      }
      if (!res.ok) throw new Error(payload.error || 'Search failed');

      const results: Job[] = Array.isArray(payload.results) ? payload.results : [];
      const cleaned = applyRoleState(results);
      setJobs(cleaned);
      setSmartActive(true);
      setSmartInfo({
        query: payload.normalized || query,
        cached: Boolean(payload.cached),
        weak: Boolean(payload.weak),
        quotaExhausted: Boolean(payload.quotaExhausted),
        alternatives: payload.alternatives || [],
      });
      setPage(1);
      setKeywordFilter('');
      setWorkTypeFilter('all');
      setJobTypeFilter('all');
      setPostedWithinFilter('all');
      setMinBudgetFilter('');
      setStatusFilter('all');
      setCountryFilter('All');
      setConnectionsFilter('all');
      setScoreFilter('all');
      setSortBy('date');

      const recents = [query, ...recentSearches.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 6);
      setRecentSearches(recents);
      if (typeof window !== 'undefined') sessionStorage.setItem('lh_recent_searches', JSON.stringify(recents));
    } catch {
      setSmartActive(true);
      setSmartInfo({ query, cached: false, weak: true, quotaExhausted: false, alternatives: [] });
      setJobs([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSmartSearch = () => {
    setSmartActive(false);
    setSmartInfo(null);
    setSmartQuery('');
    setSuggestions(null);
    setSuggestOpen(false);
    setActiveIndex(-1);
    void fetchJobs();
  };

  const flattenSuggestions = (): string[] => {
    if (!suggestions) return [];
    return [
      ...suggestions.expertise.map((s) => s.label),
      ...suggestions.roles.map((s) => s.label),
      ...suggestions.related.map((s) => s.label),
    ];
  };

  const handleSmartKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const flat = flattenSuggestions();
    if (e.key === 'Escape') {
      setSuggestOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestOpen(true);
      setActiveIndex((i) => (flat.length ? Math.min(i + 1, flat.length - 1) : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeIndex >= 0 && flat[activeIndex] ? flat[activeIndex] : smartQuery;
      void runSmartSearch(target);
    }
  };

  const handleSync = async () => {
    try {
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
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

  if (loading) {
    return (
      <div style={styles.splashLoad}>
        <div style={styles.spinner} />
        <p style={{ marginTop: 16, color: '#64748b', fontSize: 14 }}>Loading opportunities…</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>

        {/* ── INTRODUCTORY POPUP ── */}
        {showIntroPopup && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
              <button onClick={closeIntroPopup} style={styles.modalCloseBtn}>&times;</button>
              <div style={styles.modalHeaderGroup}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="Lead Hunter Logo" style={{ height: 50, width: 'auto', marginBottom: 8 }} />
                <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '4px 0' }}>Welcome to Lead Hunter</h2>
                <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, margin: 0 }}>Stop scrolling. Start winning</p>
              </div>
              <div style={styles.modalBody}>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#2563eb', margin: '12px 0 8px', textAlign: 'center' }}>
                  Only the leads worth chasing.
                </p>
                <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.6, textAlign: 'center' }}>
                  Lead Hunter automatically scans Upwork and Freelancer for high-probability contracts, scores opportunities based on verified client history, and crafts tailored, humanized proposals instantly.
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Lead Hunter Logo" style={{ height: 48, width: 'auto', objectFit: 'contain' }} />
            <div>
              <h1 style={styles.brand}>Lead Hunter</h1>
              <p style={{ fontSize: 13, color: '#16a34a', fontWeight: 700, margin: '2px 0 0' }}>
                Stop scrolling. Start winning
              </p>
            </div>
          </div>
          <div style={styles.headerRight}>
            <button onClick={openIntroPopup} style={styles.btnGhost}>
              About
            </button>
            <button onClick={() => router.push('/trends')} style={styles.btnCron}>
              Market Trends
            </button>
            <button onClick={() => router.push('/profile')} style={styles.btnCron}>
              Profile Optimizer
            </button>
            {adminMode && (
              <>
                <button onClick={() => router.push('/cron-logs')} style={styles.btnCron}>
                  Cron Logs
                </button>
                <button onClick={() => router.push('/admin/sessions')} style={{ ...styles.btnCron, background: '#1e3a8a', color: '#fff', borderColor: '#1e3a8a' }}>
                  Sessions
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
              onClick={() => { setStatusFilter(f => f === s.key ? 'all' : s.key); setPage(1); }}
              style={{
                ...styles.statCard,
                borderWidth: '2px',
                borderStyle: 'solid',
                borderColor: statusFilter === s.key ? '#2563eb' : '#e2e8f0',
                boxShadow: statusFilter === s.key ? '0 0 0 3px rgba(37,99,235,0.12)' : '0 1px 2px rgba(15,23,42,0.04)',
              }}
            >
              <div style={styles.statNum}>{s.value}</div>
              <div style={styles.statLabel}>{s.label}</div>
            </button>
          ))}
        </div>

        {/* ── FILTERS ── */}
        <div style={styles.filtersBox}>
          {/* Smart Search */}
          <div ref={searchRef} style={{ position: 'relative' }}>
            <div style={styles.filterRow}>
              <input
                type="text"
                value={smartQuery}
                onChange={e => { setSmartQuery(e.target.value); setActiveIndex(-1); }}
                onFocus={() => { if (smartQuery.trim().length >= 2 || recentSearches.length > 0) setSuggestOpen(true); }}
                onKeyDown={handleSmartKeyDown}
                placeholder="Search jobs, skills, roles, or expertise..."
                style={styles.searchInput}
              />
              <button
                onClick={() => void runSmartSearch(smartQuery)}
                disabled={searching || !smartQuery.trim()}
                style={{ ...styles.btnPrimary, opacity: (searching || !smartQuery.trim()) ? 0.5 : 1 }}
              >
                {searching ? 'Searching…' : '🔍 Search'}
              </button>
            </div>

            {/* Suggestions dropdown (local/static data only — never hits Apify) */}
            {suggestOpen && (() => {
              if (smartQuery.trim().length >= 2 && suggestions) {
                const groups: { label: string; items: SuggestItem[] }[] = [];
                if (suggestions.expertise.length) groups.push({ label: 'Based on your expertise', items: suggestions.expertise });
                if (suggestions.roles.length) groups.push({ label: 'Suggested roles', items: suggestions.roles });
                if (suggestions.related.length) groups.push({ label: 'Related', items: suggestions.related });
                if (groups.length === 0) return null;
                let idx = -1;
                return (
                  <div style={styles.suggestDropdown}>
                    {groups.map((group) => (
                      <div key={group.label}>
                        <div style={styles.suggestGroupLabel}>{group.label}</div>
                        {group.items.map((item) => {
                          idx += 1;
                          const isActive = activeIndex === idx;
                          return (
                            <button
                              key={`${group.label}-${item.label}`}
                              onMouseDown={() => void runSmartSearch(item.label)}
                              style={isActive ? { ...styles.suggestItem, ...styles.suggestItemActive } : styles.suggestItem}
                            >
                              <span style={{ flex: 1 }}>{item.label}</span>
                              <span style={styles.suggestSource}>
                                {item.source === 'profile' ? 'Your expertise' : item.source === 'jobs' ? 'In demand' : ''}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    <div style={styles.suggestFooter}>Autocomplete is free — no search quota used. Press Enter to search the exact query.</div>
                  </div>
                );
              }
              if (recentSearches.length > 0) {
                return (
                  <div style={styles.suggestDropdown}>
                    <div style={styles.suggestGroupLabel}>Recent searches</div>
                    {recentSearches.map((r) => (
                      <button key={r} onMouseDown={() => void runSmartSearch(r)} style={styles.suggestItem}>
                        <span style={{ flex: 1 }}>{r}</span>
                      </button>
                    ))}
                  </div>
                );
              }
              return null;
            })()}

            {/* Smart search active banner */}
            {smartActive && smartInfo && (
              <div style={styles.smartActiveRow}>
                <span style={styles.smartActivePill}>
                  Searching for: <b>{smartInfo.query}</b>
                </span>
                {smartInfo.cached && <span style={{ ...styles.smartTag, background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' }}>Cached</span>}
                {smartInfo.quotaExhausted && <span style={{ ...styles.smartTag, background: '#fffbeb', color: '#b45309', borderColor: '#fde68a' }}>Search quota reached — showing existing matches</span>}
                {smartInfo.weak && <span style={{ ...styles.smartTag, background: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}>Low match — try a suggestion below</span>}
                <button onClick={clearSmartSearch} style={styles.smartClearBtn}>✕ Clear Search</button>
              </div>
            )}

            {smartActive && smartInfo && smartInfo.alternatives.length > 0 && (
              <div style={styles.filterRow}>
                <span style={styles.filterLabel}>Try:</span>
                {smartInfo.alternatives.slice(0, 6).map((alt) => (
                  <button key={alt} onClick={() => void runSmartSearch(alt)} style={styles.expertiseChip}>
                    {alt}
                  </button>
                ))}
              </div>
            )}

            {/* Expertise quick picks */}
            {expertise.length > 0 && !smartActive && (
              <div style={styles.filterRow}>
                <span style={styles.filterLabel}>Based on your expertise:</span>
                {expertise.slice(0, 6).map((skill) => (
                  <button key={skill} onClick={() => void runSmartSearch(skill)} style={styles.expertiseChip}>
                    {skill}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Source tabs: Upwork (default) | Freelancer | Indeed | LinkedIn | Google Jobs */}
          <div style={styles.filterRow}>
            <span style={styles.filterLabel}>Source:</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SOURCES.map(p => (
                <button
                  key={p}
                  onClick={() => { setActiveSource(p); setPage(1); }}
                  style={{
                    ...styles.pill,
                    background: activeSource === p ? (PLATFORM_COLORS[p] || '#6c5ce7') : '#f1f5f9',
                    color: activeSource === p ? '#fff' : '#475569',
                    borderColor: activeSource === p ? (PLATFORM_COLORS[p] || '#6c5ce7') : '#e2e8f0',
                  }}
                >
                  {p}
                  <span style={{ ...styles.sourceCount, background: activeSource === p ? 'rgba(255,255,255,0.22)' : '#e2e8f0' }}>
                    {jobs.filter(j => j.platform === p).length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Compact filters row */}
          <div style={styles.filterRow}>
            <span style={styles.filterLabel}>Keyword:</span>
            <input
              type="text"
              value={keywordFilter}
              onChange={e => { setKeywordFilter(e.target.value); setPage(1); }}
              placeholder="skill, tech, location…"
              style={{ ...styles.searchInput, width: 170, fontSize: 12, padding: '6px 10px' }}
            />

            <span style={styles.filterLabel}>Work type:</span>
            <select value={workTypeFilter} onChange={e => { setWorkTypeFilter(e.target.value); setPage(1); }} style={{ ...styles.select, fontSize: 12, padding: '4px 8px' }}>
              <option value="all">Remote / Hybrid / On-site</option>
              <option value="Remote">Remote</option>
              <option value="Hybrid">Hybrid</option>
              <option value="On-site">On-site</option>
            </select>

            <span style={styles.filterLabel}>Job type:</span>
            <select value={jobTypeFilter} onChange={e => { setJobTypeFilter(e.target.value); setPage(1); }} style={{ ...styles.select, fontSize: 12, padding: '4px 8px' }}>
              <option value="all">Any type</option>
              <option value="fixed">Fixed Price</option>
              <option value="hourly">Hourly</option>
            </select>

            <span style={styles.filterLabel}>Posted:</span>
            <select value={postedWithinFilter} onChange={e => { setPostedWithinFilter(e.target.value); setPage(1); }} style={{ ...styles.select, fontSize: 12, padding: '4px 8px' }}>
              <option value="all">Any time</option>
              <option value="24h">Last 24 hours</option>
              <option value="3d">Last 3 days</option>
              <option value="7d">Last 7 days</option>
              <option value="14d">Last 14 days</option>
            </select>

            <span style={styles.filterLabel}>Min budget:</span>
            <input
              type="number"
              min={0}
              value={minBudgetFilter}
              onChange={e => { setMinBudgetFilter(e.target.value); setPage(1); }}
              placeholder="$0"
              style={{ ...styles.searchInput, width: 110, fontSize: 12, padding: '6px 10px' }}
            />
          </div>

          {/* Row 2: Country, Bid cost, Score, Sort */}
          <div style={styles.filterRow}>
            <span style={styles.filterLabel}>Country:</span>
            <select value={countryFilter} onChange={e => { setCountryFilter(e.target.value); setPage(1); }} style={styles.select}>
              {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <span style={styles.filterLabel}>Bid Cost:</span>
            <select value={connectionsFilter} onChange={e => { setConnectionsFilter(e.target.value); setPage(1); }} style={styles.select}>
              <option value="all">Any Connects</option>
              <option value="low">Low (≤5 connects)</option>
              <option value="med">Medium (6-12)</option>
              <option value="high">High (13+)</option>
            </select>

            <span style={styles.filterLabel}>Score:</span>
            <select value={scoreFilter} onChange={e => { setScoreFilter(e.target.value as 'all' | 'high' | 'medium' | 'low'); setPage(1); }} style={styles.select}>
              <option value="all">Any Match Score</option>
              <option value="high">70%+ Strong fit</option>
              <option value="medium">50–69% Promising</option>
              <option value="low">Below 50%</option>
            </select>

            <span style={styles.filterLabel}>Sort:</span>
            <select value={sortBy} onChange={e => { setSortBy(e.target.value as 'score' | 'date' | 'budget'); setPage(1); }} style={styles.select}>
              <option value="date">Latest first</option>
              <option value="score">Best match</option>
              <option value="budget">Highest budget</option>
            </select>
          </div>

          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            Showing {filteredJobs.length === 0 ? 0 : Math.min((page - 1) * PER_PAGE + 1, filteredJobs.length)}–{Math.min(page * PER_PAGE, filteredJobs.length)} of {filteredJobs.length} jobs{filteredJobs.length !== jobs.length || smartActive ? ` (filtered from ${jobs.length})` : ''}
          </div>
          {smartActive && smartInfo && (
            <div style={{ fontSize: 12, color: '#6366f1', marginTop: 2 }}>
              {smartInfo.quotaExhausted
                ? 'Showing best existing matches (live quota reached).'
                : smartInfo.cached
                  ? 'Showing cached results.'
                  : 'Showing fresh live results.'}
            </div>
          )}
        </div>

        {/* ── JOB GRID ── */}
        {paginatedJobs.length === 0 ? (
          <div style={styles.emptyBox}>
            {smartActive && smartInfo ? (
              <>
                <p style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>No strong matches for “{smartInfo.query}”</p>
                <p style={{ color: '#64748b', marginBottom: 16 }}>
                  {smartInfo.quotaExhausted
                    ? 'The live search quota is used up for now — the saved feed has nothing matching yet.'
                    : smartInfo.alternatives.length > 0
                      ? 'Try one of the suggestions above, or a broader phrase.'
                      : 'Try a broader phrase, or widen the filters.'}
                </p>
                {smartInfo.alternatives.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 }}>
                    {smartInfo.alternatives.slice(0, 4).map((alt) => (
                      <button key={alt} onClick={() => void runSmartSearch(alt)} style={styles.expertiseChip}>{alt}</button>
                    ))}
                  </div>
                ) : (
                  <button onClick={clearSmartSearch} style={styles.btnPrimary}>Back to all jobs</button>
                )}
              </>
            ) : (
              <>
                <p style={{ fontWeight: 700, fontSize: 18, color: '#0f172a' }}>No jobs match your filters</p>
                <p style={{ color: '#64748b', marginBottom: 16 }}>Try widening the filters or run a fresh sync.</p>
                {adminMode && <button onClick={handleSync} style={styles.btnPrimary}>Sync Now</button>}
              </>
            )}
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
                <article style={styles.card}>
                  {/* Card header badges */}
                  <div style={styles.cardTop}>
                    <span style={{ ...styles.badge, background: PLATFORM_COLORS[job.platform] || '#6c5ce7' }}>
                      {job.platform}
                    </span>
                    {job.isNew && <span style={{ ...styles.badge, background: '#22c55e' }}>New</span>}
                    {job.score >= 70 && <span style={{ ...styles.badge, background: '#f59e0b' }}>Hot</span>}
                    {job.applied && <span style={{ ...styles.badge, background: '#3b82f6' }}>Applied</span>}
                    {job.viewed && !job.applied && <span style={{ ...styles.badge, background: '#94a3b8' }}>Viewed</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{timeAgo(job.postedAt)}</span>
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
                        {hasClient ? `Client: ${job.clientName}` : hasCountry ? `📍 ${job.country}` : ''}
                        {job.clientSpend ? ` · Spent: ${job.clientSpend}` : ''}
                        {job.clientReviews ? ` · ⭐ ${job.clientReviews}` : ''}
                      </p>
                    );
                  })()}

                  {/* Description snippet */}
                  <p style={styles.snippet}>{job.description?.substring(0, 130)}…</p>

                  {/* Meta row */}
                  <div style={styles.metaRow}>
                    <div>
                      <div style={styles.metaKey}>Budget</div>
                      <div style={styles.metaVal}>{job.budget || 'Negotiable'}</div>
                    </div>
                    {(job.connections ?? 0) > 0 && (
                      <div>
                        <div style={styles.metaKey}>Bid Cost</div>
                        <div style={{ ...styles.metaVal, color: '#2563eb', fontWeight: 700 }}>
                          {job.connections} connects
                        </div>
                      </div>
                    )}
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={styles.metaKey}>Match</div>
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
              style={{ ...styles.pageBtn, opacity: page === totalPages ? 0.4 : 1 }}
            >
              Next →
            </button>

            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>
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
  suggestDropdown: {
    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
    background: '#fff', borderRadius: 14,
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#e2e8f0',
    boxShadow: '0 12px 24px -6px rgba(15,23,42,0.16)',
    padding: 8, maxHeight: 320, overflowY: 'auto',
  },
  suggestGroupLabel: {
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: '#94a3b8', fontWeight: 700, padding: '6px 10px 2px',
  },
  suggestItem: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
    padding: '8px 10px', borderRadius: 10, fontSize: 13,
    color: '#334155', cursor: 'pointer',
  },
  suggestItemActive: {
    background: '#eff6ff', color: '#1d4ed8',
  },
  suggestSource: { fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' },
  suggestFooter: {
    fontSize: 11, color: '#94a3b8', padding: '8px 10px 4px',
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#f1f5f9',
  },
  smartActiveRow: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
    background: '#f0f7ff', borderWidth: '1px', borderStyle: 'solid', borderColor: '#bfdbfe',
    borderRadius: 12, padding: '8px 12px',
  },
  smartActivePill: { fontSize: 13, color: '#1e40af', fontWeight: 600 },
  smartTag: {
    fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 10px',
    borderWidth: '1px', borderStyle: 'solid',
  },
  smartClearBtn: {
    marginLeft: 'auto', background: 'transparent', border: 'none',
    fontSize: 12, fontWeight: 600, color: '#1d4ed8', cursor: 'pointer',
  },
  expertiseChip: {
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#c7d2fe',
    background: '#eef2ff', color: '#4338ca', borderRadius: 999,
    padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  select: {
    borderWidth: '1px', borderStyle: 'solid', borderColor: '#dbe2ea',
    borderRadius: 999, padding: '8px 14px', fontSize: 13,
    color: '#334155', background: '#fff', cursor: 'pointer',
  },
  pill: {
    borderWidth: '1px', borderStyle: 'solid',
    borderRadius: 999, padding: '6px 14px', fontSize: 12,
    fontWeight: 700, cursor: 'pointer', position: 'relative', transition: 'all 0.15s',
  },
  sourceCount: {
    position: 'absolute', top: -6, right: -8, fontSize: 10, fontWeight: 700,
    padding: '2px 6px', borderRadius: 999, minWidth: 20, height: 18,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
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