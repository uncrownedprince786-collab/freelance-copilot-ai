import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRawJobs } from '@/lib/jobsCache';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface TrendsCache { generatedAt: string; trends: MarketTrends; }

export interface MarketTrends {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: { category: string; count: number; trend: 'rising' | 'stable' | 'declining' }[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: { skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }[];
  marketSummary: string;
  totalJobsAnalyzed: number;
}

export interface SkillTrendDelta {
  skill: string;
  previousPct: number;
  currentPct: number;
  change: number;
  pctChange: number;
  direction: 'up' | 'down' | 'stable';
  confidence: 'High' | 'Moderate' | 'Low';
}

export interface MarketShift { Growing: string[]; Stable: string[]; Declining: string[]; }

interface Snapshot {
  generatedAt: string;
  totalJobs: number;
  skillCounts: Record<string, number>;
  skillSharePct: Record<string, number>;
  categoryCounts: Record<string, number>;
  budgetBuckets: Record<string, number>;
  avgBudget: string;
}

const SKILL_ALIASES: Record<string, string> = {
  reactjs: 'react', 'react.js': 'react', 'react js': 'react',
  nextjs: 'next', 'next.js': 'next', 'next js': 'next',
  nodejs: 'node', 'node.js': 'node',
  ts: 'typescript', py: 'python', python3: 'python',
  postgres: 'postgresql', mongo: 'mongodb',
};

function normalizeSkill(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.split(' ').filter(Boolean).join(' ');
  s = s.replace(/[.]/g, '');
  return SKILL_ALIASES[s] || s;
}

async function readCache(): Promise<TrendsCache | null> {
  try {
    const record = await prisma.systemKv.findUnique({ where: { key: 'trends_cache' } });
    if (!record) return null;
    const data: TrendsCache = JSON.parse(record.value);
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL_MS) return data;
    return null;
  } catch { return null; }
}

async function writeCache(cacheData: TrendsCache): Promise<void> {
  try {
    await prisma.systemKv.upsert({
      where: { key: 'trends_cache' },
      update: { value: JSON.stringify(cacheData) },
      create: { key: 'trends_cache', value: JSON.stringify(cacheData) },
    });
  } catch {}
}

async function readHistory(): Promise<Snapshot[]> {
  try {
    const record = await prisma.systemKv.findUnique({ where: { key: 'trends_history' } });
    if (!record) return [];
    const data = JSON.parse(record.value);
    return Array.isArray(data?.snapshots) ? data.snapshots : [];
  } catch { return []; }
}

async function writeHistory(snapshots: Snapshot[]): Promise<void> {
  try {
    await prisma.systemKv.upsert({
      where: { key: 'trends_history' },
      update: { value: JSON.stringify({ snapshots }) },
      create: { key: 'trends_history', value: JSON.stringify({ snapshots }) },
    });
  } catch {}
}

async function analyzeJobsLocally(): Promise<{ skills: Record<string, number>, categories: Record<string, number>, budgets: string[], titles: string[] }> {
  const skills: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const budgets: string[] = [];
  const titles: string[] = [];

  const SKILL_KEYWORDS = [
    'react', 'node', 'python', 'django', 'typescript', 'javascript', 'next.js', 'nextjs',
    'vue', 'angular', 'laravel', 'php', 'wordpress', 'shopify', 'woocommerce',
    'flutter', 'react native', 'swift', 'kotlin', 'android', 'ios',
    'machine learning', 'ai', 'gpt', 'openai', 'langchain', 'nlp', 'chatbot',
    'aws', 'azure', 'docker', 'kubernetes', 'devops', 'ci/cd',
    'figma', 'ui/ux', 'design', 'photoshop', 'illustrator',
    'seo', 'marketing', 'copywriting', 'content writing', 'social media',
    'data analysis', 'excel', 'power bi', 'tableau', 'sql', 'postgresql', 'mongodb',
    'web scraping', 'automation', 'selenium', 'playwright',
    'api', 'rest api', 'graphql', 'stripe', 'payment gateway',
  ];

  const CATEGORY_MAP: Record<string, string[]> = {
    'Web Development': ['react', 'node', 'javascript', 'typescript', 'next.js', 'vue', 'angular', 'php', 'laravel', 'wordpress'],
    'Mobile Apps': ['flutter', 'react native', 'swift', 'kotlin', 'android', 'ios'],
    'AI / Machine Learning': ['machine learning', 'ai', 'gpt', 'openai', 'langchain', 'nlp', 'chatbot', 'python', 'data analysis'],
    'Design / UI-UX': ['figma', 'ui/ux', 'design', 'photoshop', 'illustrator'],
    'DevOps / Cloud': ['aws', 'azure', 'docker', 'kubernetes', 'devops', 'ci/cd'],
    'Marketing / SEO': ['seo', 'marketing', 'copywriting', 'content writing', 'social media'],
    'E-Commerce': ['shopify', 'woocommerce', 'stripe', 'payment gateway'],
    'Data & Analytics': ['sql', 'postgresql', 'mongodb', 'excel', 'power bi', 'tableau'],
    'Automation / Scraping': ['web scraping', 'automation', 'selenium', 'playwright'],
  };

  const jobs = await getRawJobs();
  for (const job of jobs) {
    const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
    const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
    titles.push(job.title || '');
    if (job.budget) {
      if (typeof job.budget === 'object' && job.budget.amount) budgets.push(`$${job.budget.amount}`);
      else if (typeof job.budget === 'string') budgets.push(job.budget);
    }
    if (Array.isArray(job.skills)) {
      for (const sk of job.skills) {
        const skl = sk.toLowerCase();
        if (SKILL_KEYWORDS.some(kw => skl.includes(kw) || kw.includes(skl))) {
          const matched = SKILL_KEYWORDS.find(kw => skl.includes(kw) || kw === skl) || skl;
          const canonical = normalizeSkill(matched);
          skills[canonical] = (skills[canonical] || 0) + 1;
        }
      }
    }
    for (const kw of SKILL_KEYWORDS) {
      if (text.includes(kw)) {
        const canonical = normalizeSkill(kw);
        skills[canonical] = (skills[canonical] || 0) + 1;
      }
    }
    for (const [cat, kws] of Object.entries(CATEGORY_MAP)) {
      if (kws.some(kw => text.includes(kw))) categories[cat] = (categories[cat] || 0) + 1;
    }
  }
  return { skills, categories, budgets, titles };
}

async function generateWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return '';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch { return ''; }
}

function buildSnapshot(skills: Record<string, number>, categories: Record<string, number>, budgets: string[], titles: string[]): Snapshot {
  const total = titles.length || 1;
  const skillPct: Record<string, number> = {};
  for (const [sk, cnt] of Object.entries(skills)) skillPct[sk] = Math.round((cnt / total) * 1000) / 10;

  const budgetBuckets: Record<string, number> = {
    '$0K–$100': 0, '$100–$500': 0, '$500–$2k': 0, '$2k–$10k': 0, '$10k+': 0, 'Negotiable / Hourly': 0,
  };
  for (const b of budgets) {
    const num = parseFloat(b.replace(/[^0-9.]/g, ''));
    if (isNaN(num) || b.toLowerCase().includes('hourly') || b.toLowerCase().includes('negotiable')) budgetBuckets['Negotiable / Hourly']++;
    else if (num < 100) budgetBuckets['$0K–$100']++;
    else if (num < 500) budgetBuckets['$100–$500']++;
    else if (num < 2000) budgetBuckets['$500–$2k']++;
    else if (num < 10000) budgetBuckets['$2k–$10k']++;
    else budgetBuckets['$10k+']++;
  }
  const numericBudgets = budgets.map(b => { const n = parseFloat(b.replace(/[^0-9.]/g, '')); return isNaN(n) ? null : n; }).filter((n): n is number => n !== null);
  const avgBudget = numericBudgets.length ? `$${Math.round(numericBudgets.reduce((a, b) => a + b, 0) / numericBudgets.length).toLocaleString()}` : 'N/A';

  return {
    generatedAt: new Date().toISOString(),
    totalJobs: titles.length,
    skillCounts: { ...skills },
    skillSharePct: skillPct,
    categoryCounts: { ...categories },
    budgetBuckets,
    avgBudget,
  };
}

function compareSkills(current: Snapshot, previous: Snapshot | null): SkillTrendDelta[] {
  if (!previous) return [];
  const entries: SkillTrendDelta[] = [];
  const allSkills = new Set([...Object.keys(current.skillSharePct), ...Object.keys(previous.skillSharePct)]);
  const confBase = Math.min(current.totalJobs, previous.totalJobs);
  for (const sk of allSkills) {
    const prevPct = previous.skillSharePct[sk] ?? 0;
    const curPct = current.skillSharePct[sk] ?? 0;
    const delta = Math.round((curPct - prevPct) * 100) / 100;
    const pctChange = prevPct > 0 ? Math.round((delta / prevPct) * 1000) / 10 : (curPct > 0 ? 100 : 0);
    let direction: 'up' | 'down' | 'stable' = 'stable';
    if (delta > 1.5) direction = 'up';
    else if (delta < -1.5) direction = 'down';
    let confidence: 'High' | 'Moderate' | 'Low' = 'Low';
    const cntCur = current.skillCounts[sk] ?? 0;
    const cntPrev = previous.skillCounts[sk] ?? 0;
    if (confBase >= 30 && Math.abs(delta) >= 2 && cntCur >= 3 && cntPrev >= 3) confidence = 'High';
    else if (confBase >= 15 && Math.abs(delta) >= 1 && cntCur >= 2) confidence = 'Moderate';
    entries.push({ skill: sk.charAt(0).toUpperCase() + sk.slice(1), previousPct: prevPct, currentPct: curPct, change: delta, pctChange, direction, confidence });
  }
  return entries.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.currentPct - a.currentPct);
}

function buildMarketShifts(deltas: SkillTrendDelta[]): MarketShift {
  const growing = deltas.filter(d => d.direction === 'up' && (d.confidence === 'High' || d.confidence === 'Moderate')).map(d => d.skill);
  const declining = deltas.filter(d => d.direction === 'down' && (d.confidence === 'High' || d.confidence === 'Moderate')).map(d => d.skill);
  const stable = deltas.filter(d => d.direction === 'stable' || d.confidence === 'Low').map(d => d.skill);
  return { Growing: growing.slice(0, 8), Stable: stable.slice(0, 8), Declining: declining.slice(0, 8) };
}

function rollingAverage(snapshots: Snapshot[], days: number, skill: string): number {
  const cutoff = Date.now() - days * 86400000;
  const recent = snapshots.filter(s => {
    const t = new Date(s.generatedAt).getTime();
    return t >= cutoff && t <= Date.now() && (s.skillSharePct[skill] !== undefined);
  });
  if (!recent.length) return -1;
  return Math.round((recent.reduce((sum, s) => sum + (s.skillSharePct[skill] ?? 0), 0) / recent.length) * 100) / 100;
}

export async function GET() {
  const cached = await readCache();
  const rawJobsList = await getRawJobs();
  const rawJobCount = rawJobsList.length;

  if (cached && cached.trends.totalJobsAnalyzed > 0 && rawJobCount > 0) {
    const history = await readHistory();
    if (history.length >= 2) {
      const cur = history[history.length - 1];
      const deltas = compareSkills(cur, history[history.length - 2]);
      const shifts = buildMarketShifts(deltas);
      const windows = {
        current: cur.skillSharePct,
        day7: buildWindowAvg(history, 7, cur),
        day30: buildWindowAvg(history, 30, cur),
      };
      return NextResponse.json({ ...cached.trends, cached: true, generatedAt: cached.generatedAt,
        skillTrendDeltas: deltas, marketShifts: shifts, trendWindows: windows, historyDepth: history.length });
    }
    return NextResponse.json({ ...cached.trends, cached: true, generatedAt: cached.generatedAt, historyDepth: history.length });
  }

  const { skills, categories, budgets, titles } = await analyzeJobsLocally();
  const snapshot = buildSnapshot(skills, categories, budgets, titles);

  let history = await readHistory();
  history.push(snapshot);
  if (history.length > 60) history = history.slice(-60);
  await writeHistory(history);

  const cachedAt = new Date().toISOString();
  const topSkillsRaw = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topCategoriesRaw = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const totalBudget = Object.values(snapshot.budgetBuckets).reduce((a, b) => a + b, 0) || 1;
  const budgetInsights = Object.entries(snapshot.budgetBuckets).map(([range, count]) => ({ range, count, pct: Math.round(count / totalBudget * 100) }));

  const previous = history.length >= 2 ? history[history.length - 2] : null;
  const deltas = compareSkills(snapshot, previous);
  const shifts = buildMarketShifts(deltas);
  const windows = {
    current: snapshot.skillSharePct,
    day7: buildWindowAvg(history, 7, snapshot),
    day30: buildWindowAvg(history, 30, snapshot),
  };

  const topSkillsList = topSkillsRaw.map(([s, c]) => `${s} (${c} jobs, ${snapshot.skillSharePct[s]}%)`).join(', ');
  const topCatList = topCategoriesRaw.map(([c, n]) => `${c} (${n})`).join(', ');
  const growingList = shifts.Growing.join(', ') || 'None';
  const decliningList = shifts.Declining.join(', ') || 'None';

  const aiPrompt = `You are a freelance market analyst. Based on real numbers, write a concise summary and insights.
Total jobs analyzed: ${titles.length}
Top skills (name: count, % of jobs): ${topSkillsList}
Top categories: ${topCatList}
Growing skills: ${growingList}
Declining skills: ${decliningList}
Respond with pure JSON (no markdown):
{
  "marketSummary": "2-3 sentence overview citing the numbers",
  "aiInsights": ["insight 1", "insight 2", "insight 3", "insight 4"],
  "recommendedSkillsToLearn": [
    {"skill": "skill name", "reason": "why learn it", "urgency": "high"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "medium"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "high"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "low"}
  ]
}`;

  let aiData = { marketSummary: '', aiInsights: [] as string[], recommendedSkillsToLearn: [] as Array<{ skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }> };
  const aiRaw = await generateWithGemini(aiPrompt);
  if (aiRaw) {
    try {
      const cleaned = aiRaw.replace(/```json|```/g, '').trim();
      aiData = JSON.parse(cleaned);
    } catch {}
  }

  const deterministicInsights: string[] = [];
  if (growingList) deterministicInsights.push(`Growing demand: ${growingList}.`);
  if (decliningList) deterministicInsights.push(`Declining demand: ${decliningList}.`);
  if (!deterministicInsights.length && topSkillsRaw.length) {
    deterministicInsights.push(`${topSkillsRaw[0][0]} remains the most in-demand skill (${topSkillsRaw[0][1]} jobs).`);
  }

  const trends: MarketTrends = {
    topSkills: topSkillsRaw.map(([skill, count], i) => ({
      skill: skill.charAt(0).toUpperCase() + skill.slice(1),
      count,
      growth: i < 3 ? 'Hot' : i < 7 ? 'Rising' : 'Stable',
      avgBudget: snapshot.avgBudget,
    })),
    topCategories: topCategoriesRaw.map(([category, count], i) => ({ category, count, trend: (i < 2 ? 'rising' : 'stable') as 'rising' | 'stable' | 'declining' })),
    budgetInsights,
    aiInsights: aiData.aiInsights?.length ? aiData.aiInsights : deterministicInsights,
    recommendedSkillsToLearn: aiData.recommendedSkillsToLearn?.length ? aiData.recommendedSkillsToLearn : [
      { skill: 'AI Integration (OpenAI/LangChain)', reason: 'Every client wants AI features added to their products', urgency: 'high' },
      { skill: 'Next.js + TypeScript', reason: 'Industry standard for modern web apps, massive job pool', urgency: 'high' },
      { skill: 'Flutter', reason: 'Cross-platform mobile with one codebase - client budgets are higher', urgency: 'medium' },
    ],
    marketSummary: aiData.marketSummary || `Based on ${titles.length} active jobs, demand favours AI-integrated solutions, modern web frameworks, and mobile development. ${growingList ? `Growing: ${growingList}.` : ''}`,
    totalJobsAnalyzed: titles.length,
  };

  await writeCache({ generatedAt: cachedAt, trends });

  return NextResponse.json({
    ...trends,
    cached: false,
    generatedAt: cachedAt,
    skillTrendDeltas: deltas,
    marketShifts: shifts,
    trendWindows: windows,
    historyDepth: history.length,
  });
}

function buildWindowAvg(history: Snapshot[], days: number, current: Snapshot): Record<string, number> {
  const avg: Record<string, number> = {};
  for (const sk of Object.keys(current.skillSharePct)) {
    const r = rollingAverage(history, days, sk);
    if (r >= 0) avg[sk] = r;
  }
  return avg;
}
