import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getRawJobs } from '@/lib/jobsCache';

const cacheFile = path.join(process.cwd(), '.trends-cache.json');
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface TrendsCache {
  generatedAt: string;
  trends: MarketTrends;
}

export interface MarketTrends {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: { category: string; count: number; trend: 'rising' | 'stable' | 'declining' }[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: { skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }[];
  marketSummary: string;
  totalJobsAnalyzed: number;
}

function readCache(): TrendsCache | null {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const data: TrendsCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL_MS) return data;
    return null;
  } catch { return null; }
}

function analyzeJobsLocally(): { skills: Record<string, number>, categories: Record<string, number>, budgets: string[], titles: string[], descriptions: string[] } {
  const skills: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const budgets: string[] = [];
  const titles: string[] = [];
  const descriptions: string[] = [];

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

  const jobs = getRawJobs(); // Use shared utility — same source as jobs API

  for (const job of jobs) {
    const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
    const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
    titles.push(job.title || '');
    descriptions.push((job.description || '').slice(0, 500));

    // Budget
    if (job.budget) {
      if (typeof job.budget === 'object' && job.budget.amount) budgets.push(`$${job.budget.amount}`);
      else if (typeof job.budget === 'string') budgets.push(job.budget);
    }

    // Skills from actual skills array first
    if (Array.isArray(job.skills)) {
      for (const sk of job.skills) {
        const skl = sk.toLowerCase();
        if (SKILL_KEYWORDS.some(kw => skl.includes(kw) || kw.includes(skl))) {
          const matched = SKILL_KEYWORDS.find(kw => skl.includes(kw) || kw === skl) || skl;
          skills[matched] = (skills[matched] || 0) + 1;
        }
      }
    }

    // Also scan description
    for (const kw of SKILL_KEYWORDS) {
      if (text.includes(kw)) skills[kw] = (skills[kw] || 0) + 1;
    }

    for (const [cat, kws] of Object.entries(CATEGORY_MAP)) {
      if (kws.some(kw => text.includes(kw))) {
        categories[cat] = (categories[cat] || 0) + 1;
      }
    }
  }

  return { skills, categories, budgets, titles, descriptions };
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
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch { return ''; }
}

export async function GET(req: NextRequest) {
  // Check cache — but skip if it shows 0 jobs (stale/empty data)
  const cached = readCache();
  const rawJobCount = getRawJobs().length;
  if (cached && cached.trends.totalJobsAnalyzed > 0 && rawJobCount > 0) {
    return NextResponse.json({ ...cached.trends, cached: true, generatedAt: cached.generatedAt });
  }

  const { skills, categories, budgets, titles, descriptions } = analyzeJobsLocally();

  // Sort and top-10
  const topSkillsRaw = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topCategoriesRaw = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Budget distribution
  const budgetBuckets: Record<string, number> = { '$0–$100': 0, '$100–$500': 0, '$500–$2k': 0, '$2k–$10k': 0, '$10k+': 0, 'Negotiable / Hourly': 0 };
  for (const b of budgets) {
    const num = parseFloat(b.replace(/[^0-9.]/g, ''));
    if (isNaN(num) || b.toLowerCase().includes('hourly') || b.toLowerCase().includes('negotiable')) budgetBuckets['Negotiable / Hourly']++;
    else if (num < 100) budgetBuckets['$0–$100']++;
    else if (num < 500) budgetBuckets['$100–$500']++;
    else if (num < 2000) budgetBuckets['$500–$2k']++;
    else if (num < 10000) budgetBuckets['$2k–$10k']++;
    else budgetBuckets['$10k+']++;
  }
  const total = Object.values(budgetBuckets).reduce((a, b) => a + b, 0) || 1;
  const budgetInsights = Object.entries(budgetBuckets).map(([range, count]) => ({ range, count, pct: Math.round(count / total * 100) }));

  // AI analysis
  const topSkillsList = topSkillsRaw.map(([s, c]) => `${s} (${c} jobs)`).join(', ');
  const topCatList = topCategoriesRaw.map(([c, n]) => `${c} (${n})`).join(', ');
  const sampleTitles = titles.slice(0, 20).join('; ');

  const aiPrompt = `You are a freelance market analyst. Based on these Upwork job trends, provide a JSON response.

Top skills in demand: ${topSkillsList}
Top categories: ${topCatList}
Sample job titles: ${sampleTitles}
Total jobs analyzed: ${titles.length}

Respond with this exact JSON (no markdown, pure JSON):
{
  "marketSummary": "2-3 sentence market overview",
  "aiInsights": ["insight 1", "insight 2", "insight 3", "insight 4"],
  "recommendedSkillsToLearn": [
    {"skill": "skill name", "reason": "why learn it", "urgency": "high"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "medium"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "high"},
    {"skill": "skill name", "reason": "why learn it", "urgency": "low"}
  ]
}`;

  let aiData = { marketSummary: '', aiInsights: [] as string[], recommendedSkillsToLearn: [] as any[] };
  const aiRaw = await generateWithGemini(aiPrompt);
  if (aiRaw) {
    try {
      const cleaned = aiRaw.replace(/```json|```/g, '').trim();
      aiData = JSON.parse(cleaned);
    } catch { /* use defaults */ }
  }

  const trends: MarketTrends = {
    topSkills: topSkillsRaw.map(([skill, count], i) => ({
      skill: skill.charAt(0).toUpperCase() + skill.slice(1),
      count,
      growth: i < 3 ? '🔥 Hot' : i < 7 ? '📈 Rising' : '→ Stable',
      avgBudget: budgets.length > 0 ? '$500–$2k' : 'N/A',
    })),
    topCategories: topCategoriesRaw.map(([category, count], i) => ({
      category,
      count,
      trend: i < 2 ? 'rising' : i < 5 ? 'stable' : 'stable',
    })),
    budgetInsights,
    aiInsights: aiData.aiInsights?.length ? aiData.aiInsights : [
      'AI/ML and automation skills are the fastest growing demand.',
      'React + Node.js full-stack remains the most requested combo.',
      'Mobile development (Flutter, React Native) is surging.',
      'Content writing and SEO have consistent demand across all budgets.',
    ],
    recommendedSkillsToLearn: aiData.recommendedSkillsToLearn?.length ? aiData.recommendedSkillsToLearn : [
      { skill: 'AI Integration (OpenAI/LangChain)', reason: 'Every client wants AI features added to their products', urgency: 'high' },
      { skill: 'Next.js + TypeScript', reason: 'Industry standard for modern web apps, massive job pool', urgency: 'high' },
      { skill: 'Flutter', reason: 'Cross-platform mobile with one codebase — client budgets are higher', urgency: 'medium' },
    ],
    marketSummary: aiData.marketSummary || `Based on ${titles.length} active Upwork jobs, the market is strongly favoring AI-integrated solutions, modern web frameworks, and mobile development. Freelancers with AI skills command premium rates.`,
    totalJobsAnalyzed: titles.length,
  };

  // Cache
  const cacheData: TrendsCache = { generatedAt: new Date().toISOString(), trends };
  try { fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2)); } catch { /* ignore */ }

  return NextResponse.json({ ...trends, cached: false, generatedAt: cacheData.generatedAt });
}
