import { MultiAI } from '../ai/MultiAI';
import type { PlatformAdapter } from './platforms/types';
import type {
  ProfileData,
  ProfileAnalysisResult,
  ScoreCategory,
  ScoreBreakdown,
  OptimizedProfile,
  PriorityAction,
} from './types';

const CATEGORIES: ScoreCategory[] = ['title', 'overview', 'skills', 'positioning', 'portfolio', 'clientFocus'];

export interface AnalyzeDeps {
  queryProvider?: (prompt: string) => Promise<{ provider: string; text: string } | null>;
}

const defaultMultiAI = new MultiAI();
const defaultQueryProvider = (prompt: string) => defaultMultiAI.queryProviders(prompt);

export async function analyzeProfile(profile: ProfileData, adapter: PlatformAdapter, deps: AnalyzeDeps = {}): Promise<ProfileAnalysisResult> {
  const queryProvider = deps.queryProvider ?? defaultQueryProvider;
  const prompt = buildProfilePrompt(profile, adapter);

  const aiResult = await queryProvider(prompt);
  if (aiResult?.text) {
    const parsed = parseProfileAnalysis(aiResult.text);
    if (parsed) return parsed;
  }

  return heuristicProfileAnalysis(profile);
}

function truncate(value: string | undefined, max: number): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function buildProfilePrompt(profile: ProfileData, adapter: PlatformAdapter): string {
  const platformLabel = adapter.label;
  const hints = adapter.analysisHints.map((hint) => `- ${hint}`).join('\n');

  return `You are an expert freelance profile optimizer for ${platformLabel}. Analyze the profile below and return ONLY valid JSON. Do not invent market statistics; base every claim on the profile data provided.

Platform: ${profile.platform}
Profile URL: ${profile.profileUrl || '(manual paste)'}
Name: ${truncate(profile.name, 100) || '(not provided)'}
Title: ${truncate(profile.title, 150) || '(not provided)'}
Location: ${truncate(profile.location, 100) || '(not provided)'}
Hourly rate: ${truncate(profile.hourlyRate, 100) || '(not provided)'}
Rating: ${profile.rating ?? '(not provided)'}
Reviews: ${profile.reviewsCount ?? '(not provided)'}
Completed jobs: ${profile.completedJobs ?? '(not provided)'}
Experience: ${truncate(profile.experience, 200) || '(not provided)'}
Skills: ${(profile.skills || []).slice(0, 30).join(', ') || '(none listed)'}

${profile.education?.length ? `Education:\n${profile.education.slice(0, 5).map((e) => `- ${e}`).join('\n')}\n` : ''}${profile.certifications?.length ? `Certifications:\n${profile.certifications.slice(0, 5).map((c) => `- ${c}`).join('\n')}\n` : ''}${profile.portfolioItems?.length ? `Portfolio:\n${profile.portfolioItems.slice(0, 10).map((p) => `- ${p}`).join('\n')}\n` : ''}

Overview:
${truncate(profile.overview, 4000) || '(no overview provided)'}

Platform-specific guidance for ${platformLabel} profiles:
${hints}

Return JSON with these exact keys:
{
  "overallScore": 0,
  "scores": { "title": 0, "overview": 0, "skills": 0, "positioning": 0, "portfolio": 0, "clientFocus": 0 },
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "opportunities": ["opportunity 1", "opportunity 2"],
  "marketTrends": ["trend 1", "trend 2"],
  "optimizedProfile": {
    "title": "optimized profile title",
    "overview": "optimized profile overview written for this freelancer",
    "skills": ["skill 1", "skill 2"],
    "positioning": "positioning statement that differentiates this freelancer",
    "targetClients": "description of ideal target clients",
    "portfolioRecommendations": ["recommendation 1", "recommendation 2"],
    "callToAction": "a clear call to action for prospective clients"
  },
  "priorityActions": [
    { "priority": "high", "action": "action to take", "reason": "why it matters" }
  ]
}

All scores must be integers between 0 and 100. Every "marketTrends" entry must be tied to the profile's actual skills or niche.`;
}

function clampScore(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) return 50;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function toTextArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === 'string' ? v : String(v))).map((s) => s.trim()).filter((s) => s.length > 0);
    return items.length ? items.slice(0, 12) : fallback;
  }
  return fallback;
}

function toString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function parseScoreBreakdown(value: unknown): ScoreBreakdown {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const breakdown = {} as ScoreBreakdown;
  for (const category of CATEGORIES) {
    breakdown[category] = clampScore(source[category]);
  }
  return breakdown;
}

function parsePriorityActions(value: unknown): PriorityAction[] {
  if (!Array.isArray(value)) return [];
  const actions: PriorityAction[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const priority = ['high', 'medium', 'low'].includes(String(rec.priority)) ? (rec.priority as PriorityAction['priority']) : 'medium';
    const action = toString(rec.action, '');
    if (!action) continue;
    actions.push({ priority, action, reason: toString(rec.reason, '') });
    if (actions.length >= 10) break;
  }
  return actions;
}

/**
 * Extract and validate a ProfileAnalysisResult from AI text. Returns null when
 * the response is not usable JSON so the caller can fall back to heuristics.
 */
export function parseProfileAnalysis(text: string): ProfileAnalysisResult | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const payload = match ? JSON.parse(match[0]) : JSON.parse(text);
    if (typeof payload !== 'object' || payload === null) return null;

    const scores = parseScoreBreakdown(payload.scores);
    const overallScore = clampScore(payload.overallScore);
    const fallbackTitle = String(payload.optimizedProfile?.title ?? '').trim() || 'Improved professional title';

    const optimizedProfile: OptimizedProfile = {
      title: toString(payload.optimizedProfile?.title, fallbackTitle),
      overview: toString(payload.optimizedProfile?.overview, ''),
      skills: toTextArray(payload.optimizedProfile?.skills, []),
      positioning: toString(payload.optimizedProfile?.positioning, ''),
      targetClients: toString(payload.optimizedProfile?.targetClients, ''),
      portfolioRecommendations: toTextArray(payload.optimizedProfile?.portfolioRecommendations, []),
      callToAction: toString(payload.optimizedProfile?.callToAction, ''),
    };

    return {
      overallScore,
      scores,
      strengths: toTextArray(payload.strengths, ['Profile data extracted successfully']),
      weaknesses: toTextArray(payload.weaknesses, ['Some profile sections could be strengthened']),
      opportunities: toTextArray(payload.opportunities, []),
      marketTrends: toTextArray(payload.marketTrends, []),
      optimizedProfile,
      priorityActions: parsePriorityActions(payload.priorityActions),
    };
  } catch {
    return null;
  }
}

/**
 * Deterministic, data-driven fallback used when no AI provider is available.
 * Only makes claims that are directly supported by the provided profile data.
 */
export function heuristicProfileAnalysis(profile: ProfileData): ProfileAnalysisResult {
  const skills = profile.skills || [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];

  if (profile.title) strengths.push(`Clear profile title: "${truncate(profile.title, 80)}"`);
  if (profile.overview) strengths.push('Profile overview is present and can be rewritten for conversion');
  if (skills.length > 0) strengths.push(`${skills.length} skill(s) listed: ${skills.slice(0, 6).join(', ')}`);
  if (profile.rating !== undefined && profile.rating >= 4) strengths.push(`Strong rating: ${profile.rating}`);
  if (profile.reviewsCount) strengths.push(`${profile.reviewsCount} review(s) build social proof`);
  if (profile.completedJobs) strengths.push(`${profile.completedJobs} completed job(s) demonstrate track record`);
  if (profile.portfolioItems?.length) strengths.push(`${profile.portfolioItems.length} portfolio item(s) provide proof of work`);
  if (profile.certifications?.length) strengths.push(`Certification(s): ${profile.certifications.slice(0, 3).join(', ')}`);
  if (profile.experience) strengths.push(`Stated experience: ${profile.experience}`);

  if (!profile.title) weaknesses.push('Add a clear, keyword-rich profile title');
  if (!profile.overview || (profile.overview?.length ?? 0) < 150) weaknesses.push('Expand the overview with client-focused results');
  if (skills.length === 0) weaknesses.push('List specific, searchable skills');
  if (!profile.rating) weaknesses.push('Collect ratings by completing and closing jobs successfully');
  if (!profile.portfolioItems?.length) weaknesses.push('Add portfolio samples that demonstrate your niche');
  if (profile.hourlyRate) weaknesses.push(`Current rate is ${profile.hourlyRate}; consider whether it matches the target market`);

  if (skills.length > 0) opportunities.push(`Double down on the most in-demand skill(s): ${skills.slice(0, 4).join(', ')}`);
  if (!profile.portfolioItems?.length) opportunities.push('Build 3 focused portfolio samples in your niche');
  if (!profile.overview) opportunities.push('Rewrite the overview around client outcomes and measurable results');
  if (profile.location) opportunities.push(`Emphasize the ${profile.location} timezone in collaboration preferences`);

  const scores = {} as ScoreBreakdown;
  scores.title = profile.title ? 70 : 35;
  scores.overview = profile.overview ? Math.min(90, 45 + Math.min(45, Math.floor((profile.overview.length / 500) * 45))) : 30;
  scores.skills = Math.min(90, 35 + skills.length * 5);
  scores.positioning = profile.title ? 65 : 40;
  scores.portfolio = profile.portfolioItems?.length ? 65 + Math.min(25, profile.portfolioItems.length * 5) : 35;
  scores.clientFocus = profile.overview && /\byou\b|\byour\b|client/i.test(profile.overview) ? 75 : 50;
  const overallScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / CATEGORIES.length);

  const marketTrends: string[] = [];
  if (skills.length > 0) {
    marketTrends.push(`Clients actively search for specialists in ${skills.slice(0, 3).join(', ')}.`);
  }
  marketTrends.push('Live market data requires an AI provider; this fallback reflects your profile data only.');

  const optimizedProfile: OptimizedProfile = {
    title: profile.title ? profile.title.trim() : 'Add a keyword-rich title here',
    overview: profile.overview
      ? rewriteOverview(profile)
      : `As a ${skills.slice(0, 4).join(', ') || 'skilled'} professional, I help clients deliver ${skills[0] ? 'high-quality ' + skills[0] : 'results-driven'} work. I focus on clear communication and measurable outcomes.`,
    skills,
    positioning: profile.title ? `Positioned as: ${profile.title.trim()}` : 'Define your core differentiator',
    targetClients: 'Define your ideal client by industry and project type',
    portfolioRecommendations: ['Add 3 focused samples in your core niche'],
    callToAction: 'Contact me to discuss how I can help with your project.',
  };

  const priorityActions: PriorityAction[] = [];
  if (!profile.title) priorityActions.push({ priority: 'high', action: 'Write a keyword-rich title', reason: 'Titles drive search visibility and first impressions' });
  if (!profile.overview) priorityActions.push({ priority: 'high', action: 'Write a client-focused overview', reason: 'Overview is the primary conversion section' });
  if (skills.length === 0) priorityActions.push({ priority: 'high', action: 'List relevant skills', reason: 'Skills power platform search and matching' });
  if (!profile.portfolioItems?.length) priorityActions.push({ priority: 'medium', action: 'Add portfolio samples', reason: 'Proof of work increases proposal win rate' });
  if (!profile.rating) priorityActions.push({ priority: 'low', action: 'Grow your rating and reviews', reason: 'Social proof differentiates you from competitors' });

  return {
    overallScore,
    scores,
    strengths: strengths.length ? strengths.slice(0, 6) : ['Profile data extracted successfully'],
    weaknesses: weaknesses.slice(0, 5),
    opportunities: opportunities.slice(0, 4),
    marketTrends,
    optimizedProfile,
    priorityActions,
  };
}

function rewriteOverview(profile: ProfileData): string {
  const skills = (profile.skills || []).slice(0, 6).join(', ');
  const niche = skills || 'your niche';
  const name = profile.name ? `${profile.name} is a ` : 'A ';
  const base = `${name}${profile.title || 'professional'} specializing in ${niche}. Every engagement is focused on clear communication, on-time delivery, and measurable client outcomes.`;
  return base.slice(0, 1200);
}
