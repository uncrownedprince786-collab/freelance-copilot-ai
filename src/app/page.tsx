'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Job {
  id: string;
  title: string;
  description: string;
  url: string;
  platform: string;
  budget: string;
  score: number;
  viewed: boolean;
  applied: boolean;
  postedAt: string;
  isNew?: boolean;
  company?: string;
  location?: string;
}

export default function Home() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [newJobsCount, setNewJobsCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'new' | 'viewed' | 'applied' | 'hot'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('score');
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>([]);
  const itemsPerPage = 12;

  useEffect(() => {
    void fetchJobs();
  }, []);

  useEffect(() => {
    const result = [...jobs].filter((job) => {
      if (filter === 'new') return !job.viewed && !job.applied;
      if (filter === 'viewed') return job.viewed && !job.applied;
      if (filter === 'applied') return job.applied;
      if (filter === 'hot') return job.score >= 70;
      return true;
    });

    const filtered = result.filter((job) => {
      if (selectedPlatforms.length > 0 && !selectedPlatforms.includes(job.platform)) {
        return false;
      }

      if (scoreFilter === 'high') return job.score >= 70;
      if (scoreFilter === 'medium') return job.score >= 50 && job.score < 70;
      if (scoreFilter === 'low') return job.score < 50;
      return true;
    });

    const searchValue = searchTerm.trim().toLowerCase();
    const searched = searchValue
      ? filtered.filter((job) => {
          const haystack = `${job.title} ${job.description} ${job.platform} ${job.company || ''} ${job.location || ''}`.toLowerCase();
          return haystack.includes(searchValue);
        })
      : filtered;

    if (sortBy === 'score') {
      searched.sort((a, b) => b.score - a.score);
    } else if (sortBy === 'date') {
      searched.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
    } else if (sortBy === 'budget') {
      searched.sort((a, b) => a.budget.localeCompare(b.budget));
    }

    setFilteredJobs(searched);
    setCurrentPage(1);
  }, [jobs, filter, searchTerm, selectedPlatforms, scoreFilter, sortBy]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/jobs');
      const data = await res.json();
      setJobs(data);
      const platforms: string[] = [...new Set<string>(data.map((job: Job) => job.platform))];
      setAvailablePlatforms(platforms);
      if (selectedPlatforms.length === 0) {
        setSelectedPlatforms(platforms);
      }
      setNewJobsCount(0);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage('Checking for new opportunities...');

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (data.newJobs > 0) {
        setSyncMessage(`Found ${data.newJobs} new jobs! Refreshing...`);
        setNewJobsCount(data.newJobs);
        await fetchJobs();
        window.setTimeout(() => setSyncMessage(''), 3000);
      } else {
        setSyncMessage('No new jobs found. Cache is fresh.');
        window.setTimeout(() => setSyncMessage(''), 2000);
      }
    } catch (error) {
      setSyncMessage('Sync failed. Try again.');
      window.setTimeout(() => setSyncMessage(''), 2000);
    } finally {
      setSyncing(false);
    }
  };

  const handleJobClick = (job: Job) => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedJob', JSON.stringify(job));
    }
    router.push(`/job/${job.id}`);
  };

  const handleStatFilter = (nextFilter: 'all' | 'new' | 'viewed' | 'applied' | 'hot') => {
    setFilter((current) => (current === nextFilter ? 'all' : nextFilter));
  };

  const stats = useMemo(() => ({
    total: jobs.length,
    new: jobs.filter((job) => !job.viewed && !job.applied).length,
    hot: jobs.filter((job) => job.score >= 70).length,
    applied: jobs.filter((job) => job.applied).length
  }), [jobs]);

  const paginatedJobs = useMemo(() => filteredJobs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredJobs, currentPage]);
  const totalPages = Math.ceil(filteredJobs.length / itemsPerPage);

  const getPlatformColor = (platform: string) => {
    const colors: Record<string, string> = {
      Upwork: '#14a800',
      Freelancer: '#29b2fe',
      'Remote OK': '#ff6b35',
      'WeWorkRemotely': '#3b82f6'
    };
    return colors[platform] || '#6c5ce7';
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <div style={styles.loadingText}>Loading opportunities...</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <div style={styles.brand}>Lead Hunter</div>
            <div style={styles.tagline}>Freelance opportunities, scored and ready for outreach.</div>
          </div>
          <div style={styles.headerActions}>
            {syncMessage ? <span style={styles.syncMessage}>{syncMessage}</span> : null}
          </div>
        </header>

        <div style={styles.syncStrip}>
          <div style={styles.syncText}>Keep the list fresh before you reach out.</div>
          <div style={styles.syncActions}>
            <button onClick={handleSync} disabled={syncing} style={{ ...styles.primaryBtn, opacity: syncing ? 0.7 : 1 }}>
              {syncing ? 'Syncing...' : 'Sync latest jobs'}
            </button>
            <button onClick={() => void fetchJobs()} style={styles.secondaryBtn}>Refresh list</button>
          </div>
        </div>

        {newJobsCount > 0 ? (
          <div style={styles.banner}>
            <span>{newJobsCount} new opportunities are ready to review.</span>
            <button onClick={() => void fetchJobs()} style={styles.bannerBtn}>View new</button>
          </div>
        ) : null}

        <div style={styles.statsGrid}>
          <button type="button" onClick={() => handleStatFilter('all')} style={{ ...styles.statCard, ...(filter === 'all' ? styles.statCardActive : {}) }}>
            <div style={styles.statValue}>{stats.total}</div>
            <div style={styles.statLabel}>Total leads</div>
          </button>
          <button type="button" onClick={() => handleStatFilter('new')} style={{ ...styles.statCard, ...(filter === 'new' ? styles.statCardActive : {}) }}>
            <div style={styles.statValue}>{stats.new}</div>
            <div style={styles.statLabel}>New</div>
          </button>
          <button type="button" onClick={() => handleStatFilter('hot')} style={{ ...styles.statCard, ...(filter === 'hot' ? styles.statCardActive : {}) }}>
            <div style={styles.statValue}>{stats.hot}</div>
            <div style={styles.statLabel}>Hot leads</div>
          </button>
          <button type="button" onClick={() => handleStatFilter('applied')} style={{ ...styles.statCard, ...(filter === 'applied' ? styles.statCardActive : {}) }}>
            <div style={styles.statValue}>{stats.applied}</div>
            <div style={styles.statLabel}>Applied</div>
          </button>
        </div>

        <div style={styles.filtersPanel}>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Status</label>
            <div style={styles.buttonGroup}>
              <button onClick={() => setFilter('all')} style={{ ...styles.filterBtn, ...(filter === 'all' ? styles.filterActive : {}) }}>All</button>
              <button onClick={() => setFilter('new')} style={{ ...styles.filterBtn, ...(filter === 'new' ? styles.filterActive : {}) }}>New</button>
              <button onClick={() => setFilter('viewed')} style={{ ...styles.filterBtn, ...(filter === 'viewed' ? styles.filterActive : {}) }}>Viewed</button>
              <button onClick={() => setFilter('applied')} style={{ ...styles.filterBtn, ...(filter === 'applied' ? styles.filterActive : {}) }}>Applied</button>
            </div>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Platforms</label>
            <div style={styles.buttonGroup}>
              {availablePlatforms.map((platform) => (
                <button
                  key={platform}
                  onClick={() => {
                    if (selectedPlatforms.includes(platform)) {
                      setSelectedPlatforms(selectedPlatforms.filter((item) => item !== platform));
                    } else {
                      setSelectedPlatforms([...selectedPlatforms, platform]);
                    }
                  }}
                  style={{
                    ...styles.platformBtn,
                    background: selectedPlatforms.includes(platform) ? getPlatformColor(platform) : '#f3f4f6',
                    color: selectedPlatforms.includes(platform) ? '#fff' : '#475569'
                  }}
                >
                  {platform}
                </button>
              ))}
            </div>
          </div>

          <div style={styles.filterGroup}>
            <label style={styles.filterLabel}>Score</label>
            <select value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value as 'all' | 'high' | 'medium' | 'low')} style={styles.sortSelect}>
              <option value="all">Any score</option>
              <option value="high">70%+ strong fit</option>
              <option value="medium">50%–69% promising</option>
              <option value="low">Below 50%</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <input type="text" placeholder="Search by title, description, or platform" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} style={styles.searchInput} />
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={styles.sortSelect}>
              <option value="score">Sort by score</option>
              <option value="date">Sort by date</option>
              <option value="budget">Sort by budget</option>
            </select>
          </div>
        </div>

        <div style={styles.cardsGrid}>
          {paginatedJobs.map((job) => (
            <button key={job.id} type="button" onClick={() => handleJobClick(job)} style={styles.cardButton}>
              <article style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={{ ...styles.platformBadge, background: getPlatformColor(job.platform) }}>{job.platform}</span>
                  {job.isNew ? <span style={styles.newBadge}>New</span> : null}
                  {job.score >= 70 ? <span style={styles.hotBadge}>High fit</span> : null}
                  {job.applied ? <span style={styles.appliedBadge}>Applied</span> : null}
                  {job.viewed && !job.applied ? <span style={styles.viewedBadge}>Viewed</span> : null}
                </div>

                <h3 style={styles.cardTitle}>{job.title}</h3>
                <p style={styles.cardDescription}>{job.description?.substring(0, 140)}...</p>

                <div style={styles.cardMeta}>
                  <div>
                    <div style={styles.metaLabel}>Budget</div>
                    <div style={styles.budget}>{job.budget}</div>
                  </div>
                  <div>
                    <div style={styles.metaLabel}>Posted</div>
                    <div style={styles.date}>{new Date(job.postedAt).toLocaleDateString()}</div>
                  </div>
                </div>

                <div style={styles.scoreContainer}>
                  <div style={styles.scoreBar}>
                    <div style={{ ...styles.scoreFill, width: `${job.score}%`, background: getScoreColor(job.score) }} />
                  </div>
                  <div style={styles.scoreText}>Match score {job.score}%</div>
                </div>
              </article>
            </button>
          ))}
        </div>

        {filteredJobs.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyStateTitle}>Nothing matches that filter yet.</p>
            <p style={styles.emptyStateText}>Try widening the score range, clearing a platform, or running a fresh sync.</p>
            <button onClick={handleSync} style={styles.emptyBtn}>Sync now</button>
          </div>
        ) : null}

        {totalPages > 1 ? (
          <div style={styles.pagination}>
            <button onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1} style={styles.pageBtn}>Previous</button>
            <span style={styles.pageInfo}>{currentPage} / {totalPages}</span>
            <button onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} style={styles.pageBtn}>Next</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f3f4f6',
    color: '#111827',
    padding: '24px',
    fontFamily: 'Inter, "Segoe UI", sans-serif'
  },
  shell: {
    maxWidth: '1280px',
    margin: '0 auto'
  },
  loadingContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f3f4f6',
    color: '#111827',
    fontFamily: 'Inter, "Segoe UI", sans-serif'
  },
  spinner: {
    width: '42px',
    height: '42px',
    border: '3px solid #dbeafe',
    borderTop: '3px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    marginTop: '16px',
    color: '#475569'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    flexWrap: 'wrap' as const
  },
  brand: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.02em'
  },
  tagline: {
    color: '#64748b',
    marginTop: '4px',
    fontSize: '14px'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: '10px'
  },
  primaryBtn: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  secondaryBtn: {
    background: '#fff',
    color: '#334155',
    border: '1px solid #dbe2ea',
    borderRadius: '999px',
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  },
  syncMessage: {
    fontSize: '13px',
    color: '#2563eb',
    background: '#eff6ff',
    borderRadius: '999px',
    padding: '8px 12px'
  },
  syncStrip: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    marginBottom: '20px',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
  },
  syncText: {
    color: '#475569',
    fontSize: '13px'
  },
  syncActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const
  },
  banner: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '14px',
    padding: '14px 16px',
    marginBottom: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap' as const,
    color: '#1d4ed8'
  },
  bannerBtn: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
    marginBottom: '20px'
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    padding: '16px',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
  },
  statCardActive: {
    borderColor: '#2563eb',
    boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)',
    transform: 'translateY(-1px)'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#0f172a'
  },
  statLabel: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '4px'
  },
  filtersPanel: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '16px',
    marginBottom: '20px',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
  },
  filterGroup: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px'
  },
  filterLabel: {
    minWidth: '70px',
    color: '#475569',
    fontSize: '13px',
    fontWeight: 600
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const
  },
  filterBtn: {
    border: '1px solid #dbe2ea',
    background: '#fff',
    color: '#475569',
    borderRadius: '999px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  filterActive: {
    background: '#2563eb',
    color: '#fff',
    border: '1px solid #2563eb'
  },
  platformBtn: {
    borderRadius: '999px',
    padding: '8px 12px',
    border: '1px solid #dbe2ea',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600
  },
  scoreRange: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap' as const
  },
  rangeInput: {
    accentColor: '#2563eb',
    width: '140px'
  },
  rangeValue: {
    color: '#2563eb',
    fontSize: '13px',
    fontWeight: 600
  },
  searchInput: {
    flex: 1,
    minWidth: '240px',
    border: '1px solid #dbe2ea',
    background: '#fff',
    borderRadius: '999px',
    padding: '10px 14px',
    color: '#0f172a',
    fontSize: '13px'
  },
  sortSelect: {
    border: '1px solid #dbe2ea',
    background: '#fff',
    color: '#475569',
    borderRadius: '999px',
    padding: '10px 14px',
    fontSize: '13px',
    cursor: 'pointer'
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '16px'
  },
  cardButton: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    width: '100%',
    textAlign: 'left' as const,
    cursor: 'pointer'
  },
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '18px',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    cursor: 'pointer',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease'
  },
  cardHeader: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    marginBottom: '10px'
  },
  platformBadge: {
    color: '#fff',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 700
  },
  newBadge: {
    background: '#dcfce7',
    color: '#166534',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 700
  },
  hotBadge: {
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 700
  },
  appliedBadge: {
    background: '#dcfce7',
    color: '#166534',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 700
  },
  viewedBadge: {
    background: '#f1f5f9',
    color: '#475569',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 700
  },
  cardTitle: {
    fontSize: '17px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '8px',
    lineHeight: 1.4
  },
  cardDescription: {
    fontSize: '13px',
    color: '#64748b',
    lineHeight: 1.6,
    marginBottom: '14px'
  },
  cardMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '12px'
  },
  metaLabel: {
    fontSize: '11px',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: '4px'
  },
  budget: {
    fontSize: '13px',
    color: '#0f766e',
    fontWeight: 600
  },
  date: {
    fontSize: '13px',
    color: '#334155'
  },
  scoreContainer: {
    marginTop: '8px'
  },
  scoreBar: {
    height: '6px',
    borderRadius: '999px',
    background: '#e2e8f0',
    overflow: 'hidden'
  },
  scoreFill: {
    height: '100%',
    borderRadius: '999px'
  },
  scoreText: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '6px'
  },
  emptyState: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '28px',
    textAlign: 'center' as const,
    marginTop: '20px'
  },
  emptyStateTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '6px'
  },
  emptyStateText: {
    color: '#64748b',
    marginBottom: '14px'
  },
  emptyBtn: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '10px 16px',
    cursor: 'pointer',
    fontWeight: 600
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '16px',
    marginTop: '24px'
  },
  pageBtn: {
    border: '1px solid #dbe2ea',
    background: '#fff',
    borderRadius: '999px',
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#334155'
  },
  pageInfo: {
    color: '#64748b',
    fontSize: '13px',
    fontWeight: 600
  }
};