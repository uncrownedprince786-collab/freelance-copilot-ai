import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRawJobs } from '@/lib/jobsCache';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface TrendsCache {
  generatedAt: string;
  trends: MarketTrends;
}

export interface MarketTrends {
  topSkills: { skill: string; count: number; growth: string; avgBudget: string }[];
  topCategories: { category: string; count: number; trend: 'high' | 'moderate' | 'steady' }[];
  budgetInsights: { range: string; count: number; pct: number }[];
  aiInsights: string[];
  recommendedSkillsToLearn: { skill: string; reason: string; urgency: 'high' | 'medium' | 'low' }[];
  marketSummary: string;
  totalJobsAnalyzed: number;
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
  } catch { /* non-critical */ }
}

async function analyzeJobsLocally(): Promise<{ skills: Record<string, number>, categories: Record<string, number>, budgets: string[], titles: string[], descriptions: string[] }> {
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

  const jobs = await getRawJobs(); // Use shared utility — same source as jobs API

  for (const job of jobs) {
    const skillsText = Array.isArray(job.skills) ? job.skills.join(' ').toLowerCase() : '';
    const text = `${job.title || ''} ${job.description || ''} ${skillsText}`.toLowerCase();
    titles.push(job.title || '');
    descriptions.push((job.description || '').slice(0, 500));

    // Budget — collect real listings values. Object budgets may be a single
    // amount, a min–max range, or an hourly rate; range/hourly entries are kept
    // as strings so the bucketing below can classify them honestly.
    if (job.budget) {
      if (typeof job.budget === 'object') {
        const sym = job.budget.currency || '$';
        if (job.budget.type === 'hourly') {
          budgets.push('Hourly');
        } else if (job.budget.amount) {
          budgets.push(`${sym}${job.budget.amount}`);
        } else if (job.budget.min && job.budget.max && job.budget.min !== job.budget.max) {
          budgets.push(`${sym}${job.budget.min}–${sym}${job.budget.max}`);
        } else if (job.budget.min) {
          budgets.push(`${sym}${job.budget.min}`);
        }
      } else if (typeof job.budget === 'string') {
        budgets.push(job.budget);
      }
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
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  } catch { return ''; }
}

export async function GET() {
  const cached = await readCache();
  const rawJobsList = await getRawJobs();
  const rawJobCount = rawJobsList.length;
  if (cached && cached.trends.totalJobsAnalyzed > 0 && rawJobCount > 0) {
    return NextResponse.json({ ...cached.trends, cached: true, generatedAt: cached.generatedAt });
  }

  const { skills, categories, budgets, titles } = await analyzeJobsLocally();

  // Sort and top-10
  const topSkillsRaw = Object.entries(skills).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const topCategoriesRaw = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Budget distribution — use the upper bound of a range so the bucket reflects
  // the real ceiling of the listing, and never bucket an hourly rate as a fixed
  // project budget.
  const budgetBuckets: Record<string, number> = { '$0–$100': 0, '$100–$500': 0, '$500–$2k': 0, '$2k–$10k': 0, '$10k+': 0, 'Negotiable / Hourly': 0 };
  for (const b of budgets) {
    const lower = b.toLowerCase();
    if (lower.includes('hourly') || lower.includes('negotiable')) {
      budgetBuckets['Negotiable / Hourly']++;
      continue;
    }
    const numbers = b.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    const num = numbers.length ? Math.max(...numbers) : NaN;
    if (isNaN(num)) budgetBuckets['Negotiable / Hourly']++;
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

  const aiPrompt = `You are a freelance market analyst. Based on these collected freelance job listings (Upwork + Freelancer), provide a JSON response.

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // Demand-level label reflects observed listing frequency, not a temporal trend.
      growth: i < 3 ? 'High demand' : i < 7 ? 'Moderate demand' : 'Steady demand',
      avgBudget: 'N/A', // per-skill budget averages are not computed; do not invent them
    })),
    topCategories: topCategoriesRaw.map(([category, count], i) => ({
      category,
      count,
      // Demand tier by observed listing frequency; not a temporal trend.
      trend: i < 2 ? 'high' : i < 5 ? 'moderate' : 'steady',
    })),
    budgetInsights,
    aiInsights: aiData.aiInsights?.length ? aiData.aiInsights : [
      `Most requested skill observed: ${topSkillsRaw[0]?.[0] ?? 'n/a'} (${topSkillsRaw[0]?.[1] ?? 0} of ${titles.length} jobs).`,
      `Top category observed: ${topCategoriesRaw[0]?.[0] ?? 'n/a'} (${topCategoriesRaw[0]?.[1] ?? 0} jobs).`,
      `Budget data is available for ${budgets.length} of ${titles.length} jobs.`,
      `Most common budget range observed: ${[...budgetInsights].sort((a, b) => b.count - a.count)[0]?.range ?? 'n/a'}.`,
    ],
    recommendedSkillsToLearn: aiData.recommendedSkillsToLearn?.length ? aiData.recommendedSkillsToLearn : topSkillsRaw.slice(0, 4).map(([skill, count], i) => ({
      skill: skill.charAt(0).toUpperCase() + skill.slice(1),
      reason: `Listed in ${count} of the ${titles.length} collected jobs.`,
      urgency: i < 2 ? 'high' : i < 3 ? 'medium' : 'low',
    })),
    marketSummary: aiData.marketSummary || (
      titles.length === 0
        ? 'No job data available yet. Trends will appear after the next sync.'
        : `Based on ${titles.length} collected jobs, the most requested skills are ${topSkillsRaw.slice(0, 3).map(([s]) => s).join(', ') || 'n/a'}. Demand reflects how often each skill or category appears in current listings.`
    ),
    totalJobsAnalyzed: titles.length,
  };

  // Cache
  const cacheData: TrendsCache = { generatedAt: new Date().toISOString(), trends };
  await writeCache(cacheData);

  return NextResponse.json({ ...trends, cached: false, generatedAt: cacheData.generatedAt });
}
