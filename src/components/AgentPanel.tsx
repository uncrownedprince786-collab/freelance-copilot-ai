'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { timeAgo } from '@/lib/format';
import { AGENT_GREETING, AGENT_SUGGESTIONS, AgentJobCard } from '@/lib/agentTypes';

/**
 * Platform-wide AI assistant. A floating button opens a right-side chat panel
 * that persists across navigation (mounted in the root layout). On a user's
 * first landing of the session it opens with a professional greeting — the
 * primary conversational welcome experience.
 */

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  jobs?: AgentJobCard[];
  time: number;
}

interface AgentResponse {
  reply: string;
  tool?: string;
  jobs?: AgentJobCard[];
  suggestions?: string[];
}

const MSG_KEY = 'lh_agent_messages';
const WORKING_KEY = 'lh_agent_working';
const WELCOME_KEY = 'lh_agent_welcomed';

let msgSeq = 0;
function nextId(): string {
  msgSeq += 1;
  return `m${Date.now()}_${msgSeq}`;
}

function loadJSON<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / non-window */
  }
}

function isSearchLike(text: string): boolean {
  return /(find|show|look for|search|list|jobs?|opportunit|posting)/i.test(text);
}

function renderRich(text: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  const lines = text.split(/\n/);
  let para: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      const joined = para.join(' ');
      blocks.push(<p key={key++} style={{ margin: 0 }}>{renderInline(joined)}</p>);
      para = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed)) {
      flushPara();
      const content = trimmed.replace(/^[-*•]\s+/, '');
      blocks.push(
        <div key={key++} style={{ display: 'flex', gap: 7, margin: '2px 0' }}>
          <span style={{ color: '#2563eb', flexShrink: 0 }}>•</span>
          <span>{renderInline(content)}</span>
        </div>,
      );
    } else if (trimmed === '') {
      flushPara();
    } else {
      para.push(trimmed);
    }
  }
  flushPara();
  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/\*\*(.+?)\*\*/g);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (i % 2 === 1) nodes.push(<strong key={i} style={{ fontWeight: 700 }}>{parts[i]}</strong>);
    else nodes.push(<React.Fragment key={i}>{parts[i]}</React.Fragment>);
  }
  return nodes;
}

const PLATFORM_COLORS: Record<string, string> = { Upwork: '#14a800', Freelancer: '#29b2fe' };
function scoreColor(score: number): string {
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function AgentJobCardView({ job, onNavigate }: { job: AgentJobCard; onNavigate?: () => void }) {
  return (
    <a
      href={`/job/${encodeURIComponent(job.id)}`}
      onClick={onNavigate}
      style={{
        display: 'block',
        textDecoration: 'none',
        borderRadius: 10,
        border: '1px solid #e2e8f0',
        background: '#fff',
        padding: '10px 12px',
        marginTop: 8,
      }}
      className="lh-agent-jobcard"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', background: PLATFORM_COLORS[job.platform] || '#6c5ce7', borderRadius: 999, padding: '1px 8px' }}>
          {job.platform}
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: scoreColor(job.score) }}>{job.score}%</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#94a3b8' }}>{timeAgo(job.postedAt)}</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.35, marginBottom: 3 }} className="lh-h">
        {job.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b', marginBottom: 5 }} className="lh-muted">
        <span>{job.budget}</span>
        {job.proposalCount != null && <span>· {job.proposalCount} proposals</span>}
        {job.country && <span>· {job.country}</span>}
      </div>
      {(job.skills.length > 0 || job.repeatClient || job.actFast) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {job.skills.slice(0, 3).map(s => (
            <span key={s} style={{ fontSize: 10, color: '#475569', background: '#f1f5f9', borderRadius: 999, padding: '1px 7px' }} className="lh-field">
              {s}
            </span>
          ))}
          {job.actFast && <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', border: '1px solid #fde68a', borderRadius: 999, padding: '1px 7px' }}>Act fast</span>}
          {job.repeatClient && <span style={{ fontSize: 10, fontWeight: 700, color: '#6d28d9', border: '1px solid #ddd6fe', borderRadius: 999, padding: '1px 7px' }}>Repeat client</span>}
        </div>
      )}
    </a>
  );
}

export default function AgentPanel() {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [workingJobs, setWorkingJobs] = useState<AgentJobCard[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(AGENT_SUGGESTIONS);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Restore session + first-landing welcome.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedMessages = loadJSON<AgentMessage[]>(MSG_KEY);
    const storedWorking = loadJSON<AgentJobCard[]>(WORKING_KEY);
    const welcomeShown = sessionStorage.getItem(WELCOME_KEY) === '1';
    const msgs: AgentMessage[] = storedMessages && storedMessages.length
      ? storedMessages
      : [{ id: nextId(), role: 'assistant', content: AGENT_GREETING, time: Date.now() }];
    setMessages(msgs);
    setWorkingJobs(storedWorking ?? []);
    if (!welcomeShown) {
      sessionStorage.setItem(WELCOME_KEY, '1');
    }
    setHydrated(true);
  }, []);

  // Persist on change.
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(MSG_KEY, messages);
  }, [messages, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(WORKING_KEY, workingJobs);
  }, [workingJobs, hydrated]);

  // Auto-scroll to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open && hydrated) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, hydrated]);

  const resetChat = useCallback(() => {
    setMessages([{ id: nextId(), role: 'assistant', content: AGENT_GREETING, time: Date.now() }]);
    setWorkingJobs([]);
    setSuggestions(AGENT_SUGGESTIONS);
    setError(null);
  }, []);

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || loading || !hydrated) return;
      setInput('');
      setError(null);

      const userMsg: AgentMessage = { id: nextId(), role: 'user', content: text.slice(0, 2000), time: Date.now() };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setLoading(true);
      setSuggestions([]);

      const payload = {
        messages: updated.map(m => ({ role: m.role, content: m.content })),
        workingJobs,
      };

      try {
        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const errMsg = res.status === 401
            ? 'Please sign in to continue the conversation.'
            : 'I couldn\'t retrieve that right now. Please try again.';
          setError(errMsg);
          const fallback: AgentMessage = {
            id: nextId(),
            role: 'assistant',
            content: data?.reply && typeof data.reply === 'string' ? data.reply : 'I couldn\'t retrieve that right now. Please try again, or tell me what type of jobs you\'d like me to look for.',
            time: Date.now(),
          };
          setMessages(prev => [...prev, fallback]);
          setSuggestions(data?.suggestions ?? AGENT_SUGGESTIONS);
          return;
        }
        const data = (await res.json()) as AgentResponse;
        const replyText = data.reply || 'I couldn\'t find an answer for that. Try rephrasing, or ask me about jobs, market trends, or the platform.';
        const assistantMsg: AgentMessage = {
          id: nextId(),
          role: 'assistant',
          content: replyText,
          jobs: Array.isArray(data.jobs) ? data.jobs.slice(0, 8) : undefined,
          time: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        if (Array.isArray(data.jobs)) setWorkingJobs(data.jobs.slice(0, 8));
        setSuggestions(data.suggestions ?? AGENT_SUGGESTIONS);
      } catch {
        setError('Something went wrong while reaching the assistant. Please try again.');
        setMessages(prev => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: 'I couldn\'t retrieve those opportunities right now. Please try again, or tell me what type of jobs you\'d like me to look for.',
            time: Date.now(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, hydrated, messages, workingJobs],
  );

  const typingLabel = useMemo(() => {
    const last = [...messages].reverse().find(m => m.role === 'user');
    return last && isSearchLike(last.content) ? 'Searching opportunities…' : 'Thinking…';
  }, [messages]);

  const jobCount = useMemo(() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    return lastAssistant?.jobs?.length ?? 0;
  }, [messages]);

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          zIndex: 70,
          width: 54,
          height: 54,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: open ? '#0f172a' : '#2563eb',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(37,99,235,0.35)',
        }}
        className="lh-agent-fab"
      >
        {open ? <X size={24} /> : <Sparkles size={24} />}
      </button>

      {open && hydrated && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} aria-hidden onClick={() => setOpen(false)} className="lh-agent-backdrop" />
      )}

      {/* Side panel */}
      {open && hydrated && (
        <div
          role="dialog"
          aria-label="Lead Hunter AI assistant"
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 65,
            width: 'min(400px, 100vw)',
            display: 'flex',
            flexDirection: 'column',
            background: '#f8fafc',
            borderLeft: '1px solid #e2e8f0',
            boxShadow: '-12px 0 32px rgba(15,23,42,0.12)',
          }}
          className="lh-agent-panel"
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#0f172a', color: '#fff' }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Bot size={18} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Lead Hunter Assistant</div>
              <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                Platform AI copilot
              </div>
            </div>
            <button
              type="button"
              onClick={resetChat}
              aria-label="Start a new conversation"
              title="New conversation"
              style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 6, display: 'flex' }}
            >
              <RefreshCw size={16} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 6, display: 'flex' }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }} className="lh-agent-scroll">
            {messages.map(m =>
              m.role === 'user' ? (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <div
                    style={{
                      maxWidth: '86%',
                      background: '#2563eb',
                      color: '#fff',
                      borderRadius: '14px 14px 3px 14px',
                      padding: '9px 13px',
                      fontSize: 13,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      maxWidth: '94%',
                      background: '#fff',
                      color: '#1e293b',
                      borderRadius: '14px 14px 14px 3px',
                      padding: '10px 13px',
                      fontSize: 13,
                      lineHeight: 1.55,
                      border: '1px solid #eef1f5',
                      wordBreak: 'break-word',
                    }}
                    className="lh-agent-msg"
                  >
                    {renderRich(m.content)}
                    {m.jobs && m.jobs.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {m.jobs.map(job => (
                          <AgentJobCardView key={job.id} job={job} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, paddingLeft: 4 }}>
                    {timeAgo(new Date(m.time).toISOString())}
                  </div>
                </div>
              ),
            )}

            {loading && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={14} color="#fff" />
                </div>
                <div className="lh-agent-msg" style={{ background: '#fff', border: '1px solid #eef1f5', borderRadius: 14, padding: '10px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="lh-typing">
                    <i /><i /><i />
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{typingLabel}</span>
                </div>
              </div>
            )}

            {!loading && jobCount > 0 && (
              <div style={{ fontSize: 11.5, color: '#64748b', margin: '2px 4px 6px', display: 'flex', alignItems: 'center', gap: 6 }} className="lh-muted">
                <ArrowUp size={12} />
                Results are shown as cards — open one to view the full analysis.
              </div>
            )}

            {!loading && suggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
                {suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    style={{
                      fontSize: 11.5,
                      color: '#2563eb',
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      borderRadius: 999,
                      padding: '5px 11px',
                      cursor: 'pointer',
                    }}
                    className="lh-agent-suggest"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  fontSize: 12,
                  color: '#b91c1c',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 10,
                  padding: '9px 12px',
                  margin: '4px 0 8px',
                  lineHeight: 1.5,
                }}
                className="lh-agent-error"
              >
                {error}
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px 14px', borderTop: '1px solid #eef1f5', background: '#f8fafc' }} className="lh-agent-inputbar">
            <form
              onSubmit={e => {
                e.preventDefault();
                void send();
              }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about jobs, trends, or which to prioritize…"
                aria-label="Message the assistant"
                maxLength={2000}
                disabled={loading}
                style={{
                  flex: 1,
                  border: '1px solid #dbe2ea',
                  borderRadius: 999,
                  padding: '10px 15px',
                  fontSize: 13,
                  color: '#0f172a',
                  background: '#fff',
                  outline: 'none',
                }}
                className="lh-agent-input"
              />
              <button
                type="submit"
                aria-label="Send message"
                disabled={loading || !input.trim()}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  background: input.trim() && !loading ? '#2563eb' : '#cbd5e1',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Send size={17} />
              </button>
            </form>
            <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>
              The assistant uses live platform data and never invents listings or market figures.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
