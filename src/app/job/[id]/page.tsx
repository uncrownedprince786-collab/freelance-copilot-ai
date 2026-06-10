'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

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
  company?: string;
  location?: string;
  isNew?: boolean;
}

interface Analysis {
  summary: string;
  score: number;
  risk: string;
  reasons: string[];
  bidAmount: string;
  questions: string[];
  proposal: string;
  originalBudget?: string;
  originalTimeline?: string;
  clientDetails?: string;
  technicalBlockers?: string[];
  blockerSolutions?: string[];
  suggestedEta?: string;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [proposal, setProposal] = useState('');
  const [proposalDraft, setProposalDraft] = useState('');
  const [bidSuggestion, setBidSuggestion] = useState('');
  const [showFullProposal, setShowFullProposal] = useState(false);

  useEffect(() => {
    const storedJob = sessionStorage.getItem('selectedJob');
    if (storedJob) {
      try {
        const parsed = JSON.parse(storedJob);
        if (parsed?.title) {
          setJob(parsed);
          setLoading(false);
          void fetchAnalysis(parsed);
          sessionStorage.removeItem('selectedJob');
          return;
        }
      } catch (error) {
        console.error('Failed to parse selected job', error);
      }
    }
    void loadJob();
  }, [params?.id]);

  const loadJob = async () => {
    try {
      const res = await fetch('/api/jobs');
      const jobs = await res.json();
      const found = jobs.find((entry: Job) => entry.id === params.id);
      if (found) {
        setJob(found);
        await fetchAnalysis(found);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalysis = async (jobData: Job) => {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: jobData.title,
          description: jobData.description,
          platform: jobData.platform,
          budget: jobData.budget
        })
      });
      const data = await res.json();
      setAnalysis(data);

      let personalizedProposal = data.proposal || data.summary;
      const clientName = jobData.company || 'Hiring Manager';
      const skillMatch = jobData.title.split(' ').slice(0, 3).join(' ');

      personalizedProposal = personalizedProposal
        .replace(/hi there/i, `Hi ${clientName},`)
        .replace(/dear client/i, `Dear ${clientName}`)
        .replace(/best regards/i, `Best regards,\n${jobData.platform === 'Upwork' ? 'A strong fit for this project' : 'A reliable freelancer ready to help'}`);

      personalizedProposal = `${personalizedProposal}\n\nI understand the importance of a smooth delivery process and would make sure the project stays clear, organized, and aligned with your expectations. I would be glad to discuss the scope and propose a practical path forward for ${skillMatch}.`;

      setProposal(personalizedProposal);
      setProposalDraft(personalizedProposal);
      setBidSuggestion(data.bidAmount || '$1000-$2500');
    } catch (error) {
      console.error('Analysis error:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const markAsViewed = async () => {
    if (job) {
      await fetch('/api/jobs/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id })
      });
      window.open(job.url, '_blank');
      setJob({ ...job, viewed: true });
    }
  };

  const markAsApplied = async () => {
    if (job) {
      await fetch('/api/jobs/applied', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id })
      });
      setJob({ ...job, applied: true });
    }
  };

  const copyProposal = async () => {
    await navigator.clipboard.writeText(proposalDraft || proposal);
  };

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
      <div style={styles.page}>
        <div style={styles.loading}>Loading job details...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div style={styles.page}>
        <div style={styles.notFound}>
          <h2 style={styles.notFoundTitle}>Job not found</h2>
          <button onClick={() => router.push('/')} style={styles.backBtn}>Back to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <button onClick={() => router.push('/')} style={styles.backBtn}>Back to dashboard</button>

        <div style={styles.layout}>
          <section style={styles.mainCard}>
            <div style={styles.cardHeader}>
              <span style={{ ...styles.platformBadge, background: getPlatformColor(job.platform) }}>{job.platform}</span>
              {job.isNew ? <span style={styles.newBadge}>New</span> : null}
              {job.applied ? <span style={styles.appliedBadge}>Applied</span> : null}
              {job.viewed && !job.applied ? <span style={styles.viewedBadge}>Viewed</span> : null}
            </div>

            <h1 style={styles.title}>{job.title}</h1>
            <p style={styles.subtitle}>{job.company || 'Client'} • {job.location || 'Remote'} • {job.budget}</p>

            <div style={styles.metaGrid}>
              <div style={styles.metaCard}>
                <div style={styles.metaLabel}>Platform</div>
                <div style={styles.metaValue}>{job.platform}</div>
              </div>
              <div style={styles.metaCard}>
                <div style={styles.metaLabel}>Posted</div>
                <div style={styles.metaValue}>{new Date(job.postedAt).toLocaleDateString()}</div>
              </div>
              <div style={styles.metaCard}>
                <div style={styles.metaLabel}>Budget</div>
                <div style={styles.metaValue}>{job.budget}</div>
              </div>
            </div>

            <div style={styles.scoreBlock}>
              <div style={styles.scoreCircle}>
                <div style={{ ...styles.scoreNumber, color: getScoreColor(job.score) }}>{job.score}%</div>
                <div style={styles.scoreLabel}>Match score</div>
              </div>
              <div style={styles.scoreCopy}>
                <h3 style={styles.sectionTitle}>Opportunity fit</h3>
                <p style={styles.sectionText}>{job.score >= 70 ? 'This looks like a strong fit with clear upside for a tailored proposal.' : 'This looks workable, but the scope and budget should be verified before sending a bid.'}</p>
              </div>
            </div>

            <div style={styles.sectionBlock}>
              <h3 style={styles.sectionTitle}>Project description</h3>
              <div style={styles.description}>{job.description}</div>
            </div>

            <div style={styles.actions}>
              <button onClick={markAsViewed} style={styles.primaryBtn}>Open listing</button>
              {!job.applied ? <button onClick={markAsApplied} style={styles.secondaryBtn}>Mark as applied</button> : null}
            </div>
          </section>

          <aside style={styles.sidebar}>
            {analyzing ? (
              <div style={styles.aiCard}>
                <h3 style={styles.sectionTitle}>AI review</h3>
                <div style={styles.analyzingState}>
                  <div style={styles.spinnerSmall} />
                  <p style={styles.sectionText}>Reviewing scope, risk, and the best angle for outreach.</p>
                </div>
              </div>
            ) : analysis ? (
              <div style={styles.aiCard}>
                <div style={styles.aiHeader}>
                  <div>
                    <h3 style={styles.sectionTitle}>AI review</h3>
                    <p style={styles.sectionText}>A quick decision support layer for outreach.</p>
                  </div>
                </div>

                <div style={styles.verdictRow}>
                  <div style={styles.verdictItem}>
                    <div style={styles.verdictLabel}>Score</div>
                    <div style={{ ...styles.verdictValue, color: getScoreColor(analysis.score) }}>{analysis.score}/100</div>
                  </div>
                  <div style={styles.verdictItem}>
                    <div style={styles.verdictLabel}>Risk</div>
                    <div style={{ ...styles.verdictValue, color: analysis.risk === 'Low' ? '#16a34a' : analysis.risk === 'High' ? '#dc2626' : '#d97706' }}>{analysis.risk}</div>
                  </div>
                  <div style={styles.verdictItem}>
                    <div style={styles.verdictLabel}>Bid</div>
                    <div style={styles.verdictValue}>{analysis.bidAmount}</div>
                  </div>
                </div>

                <div style={styles.sectionBlock}>
                  <h4 style={styles.subTitle}>Executive summary</h4>
                  <p style={styles.sectionText}>{analysis.summary}</p>
                </div>

                <div style={styles.sectionBlock}>
                  <h4 style={styles.subTitle}>Project context and client details</h4>
                  <div style={styles.infoGrid}>
                    <div style={styles.infoCard}>
                      <div style={styles.metaLabel}>Original budget</div>
                      <div style={styles.metaValue}>{analysis.originalBudget || job.budget}</div>
                    </div>
                    <div style={styles.infoCard}>
                      <div style={styles.metaLabel}>Original timeline</div>
                      <div style={styles.metaValue}>{analysis.originalTimeline || 'Flexible'}</div>
                    </div>
                  </div>
                  <p style={styles.sectionText}>{analysis.clientDetails || 'The client shared a scope request that should be reviewed carefully before you bid.'}</p>
                </div>

                <div style={styles.sectionBlock}>
                  <h4 style={styles.subTitle}>What matters most</h4>
                  <ul style={styles.list}>
                    {analysis.reasons?.map((reason, index) => <li key={index} style={styles.listItem}>{reason}</li>)}
                  </ul>
                </div>

                <div style={styles.sectionBlock}>
                  <h4 style={styles.subTitle}>Technical blockers and suggested response</h4>
                  <ul style={styles.list}>
                    {(analysis.technicalBlockers?.length ? analysis.technicalBlockers : ['No major blocker detected from the listing.']).map((blocker, index) => (
                      <li key={index} style={styles.listItem}>{blocker}</li>
                    ))}
                  </ul>
                  {analysis.blockerSolutions?.length ? (
                    <div style={styles.solutionBox}>
                      <div style={styles.metaLabel}>Suggested approach</div>
                      <ul style={styles.list}>
                        {analysis.blockerSolutions.map((solution, index) => <li key={index} style={styles.listItem}>{solution}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div style={styles.sectionBlock}>
                  <h4 style={styles.subTitle}>Questions to ask</h4>
                  <ul style={styles.list}>
                    {analysis.questions?.map((question, index) => <li key={index} style={styles.listItem}>{question}</li>)}
                  </ul>
                </div>

                <div style={styles.sectionBlock}>
                  <div style={styles.proposalHeader}>
                    <h4 style={styles.subTitle}>Suggested bid for this project</h4>
                    <button onClick={() => job && void fetchAnalysis(job)} style={styles.ghostBtn} disabled={analyzing}>Refresh proposal</button>
                  </div>
                  <div style={styles.bidSummary}>
                    <div style={styles.bidSummaryItem}>
                      <div style={styles.metaLabel}>Project budget</div>
                      <div style={styles.metaValue}>{analysis.originalBudget || job.budget}</div>
                    </div>
                    <div style={styles.bidSummaryItem}>
                      <div style={styles.metaLabel}>AI suggested bid</div>
                      <div style={styles.metaValue}>{bidSuggestion || analysis.bidAmount}</div>
                    </div>
                    <div style={styles.bidSummaryItem}>
                      <div style={styles.metaLabel}>Suggested ETA</div>
                      <div style={styles.metaValue}>{analysis.suggestedEta || 'Flexible'}</div>
                    </div>
                  </div>
                  <input
                    value={bidSuggestion}
                    onChange={(event) => setBidSuggestion(event.target.value)}
                    style={styles.bidInput}
                    placeholder="Suggested bid"
                  />
                  <textarea
                    value={proposalDraft}
                    onChange={(event) => setProposalDraft(event.target.value)}
                    style={styles.proposalTextarea}
                    rows={showFullProposal ? 16 : 10}
                  />
                  <div style={styles.proposalActions}>
                    <button onClick={() => setShowFullProposal((value) => !value)} style={styles.ghostBtn}>{showFullProposal ? 'Show less' : 'Read full'}</button>
                    <button onClick={() => void copyProposal()} style={styles.primarySmallBtn}>Copy proposal</button>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
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
  loading: {
    textAlign: 'center' as const,
    padding: '50px',
    color: '#111827'
  },
  backBtn: {
    background: '#fff',
    border: '1px solid #dbe2ea',
    borderRadius: '999px',
    padding: '10px 16px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#334155',
    marginBottom: '20px'
  },
  notFound: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '16px',
    padding: '36px',
    textAlign: 'center' as const,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
  },
  notFoundTitle: {
    fontSize: '22px',
    marginBottom: '12px',
    color: '#0f172a'
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '1.3fr 0.9fr',
    gap: '20px'
  },
  mainCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '18px',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  aiCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '18px',
    padding: '16px',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)'
  },
  cardHeader: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    marginBottom: '12px'
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
  title: {
    fontSize: '24px',
    fontWeight: 700,
    lineHeight: 1.25,
    color: '#0f172a',
    marginBottom: '6px'
  },
  subtitle: {
    color: '#64748b',
    fontSize: '13px',
    marginBottom: '14px'
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '10px',
    marginBottom: '14px'
  },
  metaCard: {
    background: '#f8fafc',
    borderRadius: '12px',
    padding: '10px 12px'
  },
  metaLabel: {
    fontSize: '11px',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: '4px'
  },
  metaValue: {
    fontSize: '14px',
    color: '#0f172a',
    fontWeight: 600
  },
  scoreBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    border: '1px solid #e2e8f0',
    borderRadius: '14px',
    background: '#f8fafc',
    marginBottom: '14px'
  },
  scoreCircle: {
    minWidth: '84px',
    textAlign: 'center' as const
  },
  scoreNumber: {
    fontSize: '24px',
    fontWeight: 700
  },
  scoreLabel: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '4px'
  },
  scoreCopy: {
    flex: 1
  },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '4px'
  },
  subTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#0f172a',
    marginBottom: '6px'
  },
  sectionText: {
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.6
  },
  sectionBlock: {
    marginBottom: '14px'
  },
  description: {
    whiteSpace: 'pre-wrap' as const,
    color: '#475569',
    lineHeight: 1.7,
    fontSize: '13px',
    maxHeight: '280px',
    overflowY: 'auto' as const,
    paddingRight: '8px',
    paddingTop: '2px',
    paddingBottom: '2px'
  },
  actions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    marginTop: '14px'
  },
  primaryBtn: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '10px 16px',
    cursor: 'pointer',
    fontWeight: 600
  },
  secondaryBtn: {
    background: '#fff',
    color: '#334155',
    border: '1px solid #dbe2ea',
    borderRadius: '999px',
    padding: '10px 16px',
    cursor: 'pointer',
    fontWeight: 600
  },
  aiHeader: {
    marginBottom: '12px'
  },
  verdictRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    background: '#f8fafc',
    borderRadius: '14px',
    padding: '12px',
    marginBottom: '14px'
  },
  verdictItem: {
    textAlign: 'center' as const
  },
  verdictLabel: {
    fontSize: '11px',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    marginBottom: '4px'
  },
  verdictValue: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#0f172a'
  },
  list: {
    paddingLeft: '18px',
    color: '#475569'
  },
  listItem: {
    marginBottom: '8px',
    lineHeight: 1.6,
    fontSize: '13px'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '10px',
    marginBottom: '8px'
  },
  infoCard: {
    background: '#f8fafc',
    borderRadius: '12px',
    padding: '10px 12px'
  },
  solutionBox: {
    marginTop: '8px',
    border: '1px solid #dbe2ea',
    borderRadius: '12px',
    padding: '10px 12px',
    background: '#f8fafc'
  },
  proposalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px',
    flexWrap: 'wrap' as const
  },
  bidSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '10px',
    marginBottom: '10px'
  },
  bidSummaryItem: {
    background: '#f8fafc',
    borderRadius: '12px',
    padding: '10px 12px'
  },
  bidInput: {
    width: '100%',
    border: '1px solid #dbe2ea',
    borderRadius: '10px',
    padding: '10px 12px',
    fontSize: '13px',
    marginBottom: '8px',
    color: '#0f172a'
  },
  proposalTextarea: {
    width: '100%',
    minHeight: '220px',
    border: '1px solid #dbe2ea',
    borderRadius: '12px',
    padding: '12px',
    color: '#334155',
    fontSize: '13px',
    lineHeight: 1.6,
    resize: 'vertical' as const,
    background: '#f8fafc',
    marginBottom: '10px'
  },
  proposalActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const
  },
  ghostBtn: {
    background: '#fff',
    border: '1px solid #dbe2ea',
    borderRadius: '999px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#334155'
  },
  primarySmallBtn: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '999px',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600
  },
  analyzingState: {
    textAlign: 'center' as const,
    padding: '18px 0'
  },
  spinnerSmall: {
    width: '30px',
    height: '30px',
    border: '3px solid #dbeafe',
    borderTop: '3px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 10px'
  }
};