import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { MultiAI } from '../src/services/ai/MultiAI';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const cacheFile = 'sync-results.json';
const quotaFile = '.upwork-quota.json';
const forceSync = process.env.FORCE_SYNC === 'true';
const aiScorer = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROK_API_KEY || process.env.DEEPSEEK_API_KEY
  ? new MultiAI()
  : null;

async function sync() {
  console.log('\n========================================');
  console.log('     LEAD HUNTER - MULTI PLATFORM SYNC');
  console.log('========================================\n');

  const cacheExists = fs.existsSync(cacheFile);

  if (cacheExists && !forceSync) {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const cacheTime = new Date(cache.timestamp);
    const now = new Date();
    const hoursDiff = (now.getTime() - cacheTime.getTime()) / (1000 * 60 * 60);

    console.log(`Last sync: ${cacheTime.toLocaleString()}`);
    console.log(`Cache age: ${hoursDiff.toFixed(1)} hours`);

    if (hoursDiff < 24) {
      console.log(`\nUsing cached data (${cache.totalJobs} jobs from ${cache.platforms?.join(', ') || 'Upwork'})`);
      console.log('To force refresh, delete sync-results.json or set FORCE_SYNC=true\n');
      return;
    }
  }

  if (fs.existsSync(quotaFile)) {
    const quota = JSON.parse(fs.readFileSync(quotaFile, 'utf-8'));
    const remaining = 100 - (quota.searchesUsed || 0);
    console.log(`Upwork API Quota: ${remaining}/100 searches remaining`);

    if (remaining <= 0) {
      console.log('Daily quota exhausted for Upwork. Other platforms will still work.\n');
    }
  }

  console.log('\nFetching fresh opportunities from all platforms...\n');

  const allJobs: any[] = [];
  const platforms: string[] = [];

  const collectors = [
    { name: 'Upwork', file: 'UpworkCollector', enabled: true },
    { name: 'Freelancer', file: 'FreelancerCollector', enabled: true },
    { name: 'RemoteOK', file: 'RemoteOkCollector', enabled: true },
    { name: 'WeWorkRemotely', file: 'WeWorkRemotelyCollector', enabled: true }
  ];

  for (const collector of collectors) {
    if (!collector.enabled) continue;

    console.log(`\n--- ${collector.name} ---`);

    try {
      const module = await import(`../src/collectors/${collector.file}`);
      const CollectorClass = module[collector.file] || module[collector.name + 'Collector'];
      const instance = new CollectorClass();
      const jobs = await instance.fetch();

      if (jobs && jobs.length > 0) {
        const scoredJobs = [] as any[];

        for (const job of jobs) {
          if (!looksAuthentic(job.title, job.description)) {
            continue;
          }

          const baseScore = calculateScore(job.title, job.description);
          const score = await scoreOpportunity(job, collector.name, baseScore, aiScorer);
          scoredJobs.push({
            ...job,
            score,
            platform: collector.name
          });
        }

        allJobs.push(...scoredJobs);
        platforms.push(collector.name);
        console.log(`Total from ${collector.name}: ${scoredJobs.length} jobs`);
      } else {
        console.log(`No jobs from ${collector.name}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.error(`Failed to fetch from ${collector.name}:`, error.message);
    }
  }

  const uniqueJobs = removeDuplicates(allJobs);
  const recentJobs = filterByDate(uniqueJobs, 3);

  console.log('\n========================================');
  console.log('             SYNC SUMMARY');
  console.log('========================================');
  console.log(`Total raw jobs: ${allJobs.length}`);
  console.log(`After duplicate removal: ${uniqueJobs.length}`);
  console.log(`After 3-day filter: ${recentJobs.length}`);
  console.log(`Platforms: ${platforms.join(', ')}`);

  fs.writeFileSync(cacheFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalJobs: recentJobs.length,
    platforms: [...new Set(platforms)],
    jobs: recentJobs
  }, null, 2));

  console.log(`\nSaved ${recentJobs.length} jobs to cache\n`);
}

function removeDuplicates(jobs: any[]): any[] {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const job of jobs) {
    const normalizedTitle = job.title.toLowerCase().trim();
    const key = `${normalizedTitle}|${job.platform}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(job);
    }
  }

  return unique;
}

function filterByDate(jobs: any[], maxDays: number): any[] {
  const now = new Date();
  return jobs.filter(job => {
    if (!job.postedDate) return true;
    const posted = new Date(job.postedDate);
    const daysDiff = (now.getTime() - posted.getTime()) / (1000 * 60 * 60 * 24);
    return daysDiff <= maxDays;
  });
}

function looksAuthentic(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  const suspicious = [
    'data entry',
    'virtual assistant',
    'customer support',
    'video editing',
    'transcription',
    'social media manager',
    'copywriting',
    'article writer',
    'cheap',
    'quick fix',
    'simple website',
    'simple landing page',
    'easy project',
    'low budget',
    'bitcoin',
    'crypto signal',
    'telegram',
    'whatsapp'
  ];
  const stackSignals = [
    'wordpress',
    'php',
    'laravel',
    'javascript',
    'typescript',
    'react',
    'nextjs',
    'next.js',
    'node',
    'nodejs',
    'python',
    'django',
    'full stack',
    'mobile',
    'react native',
    'flutter',
    'ios',
    'android',
    'api',
    'web app',
    'saas',
    'shopify',
    'magento',
    'webflow',
    'cms',
    'developer',
    'engineer',
    'architect',
    'programmer'
  ];

  if (suspicious.some((keyword) => text.includes(keyword))) {
    return false;
  }

  return stackSignals.some((keyword) => text.includes(keyword));
}

function calculateScore(title: string, description: string): number {
  const text = (title + ' ' + description).toLowerCase();
  let score = 50;

  const positive = ['urgent', 'long term', 'production', 'api', 'database', 'mobile', 'full stack', 'senior', 'cloud', 'aws', 'react', 'node', 'python', 'webrtc', 'wordpress', 'laravel', 'php', 'shopify', 'magento', 'nextjs', 'typescript'];
  const negative = ['simple', 'easy', 'beginner', 'cheap', 'fix bug', 'tutorial', 'small budget', 'quick fix'];

  positive.forEach((kw) => { if (text.includes(kw)) score += 4; });
  negative.forEach((kw) => { if (text.includes(kw)) score -= 5; });

  if (description.length > 300) score += 5;
  if (description.length < 80) score -= 8;
  if (title.toLowerCase().includes('senior') || title.toLowerCase().includes('full stack')) score += 8;

  return Math.min(100, Math.max(0, score));
}

async function scoreOpportunity(job: any, platform: string, baseScore: number, aiScorer: MultiAI | null): Promise<number> {
  if (!aiScorer || baseScore < 55) {
    return baseScore;
  }

  try {
    const aiResult = await aiScorer.analyze(job.title, job.description, { platform, budget: job.budget });
    return Math.min(100, Math.round(baseScore * 0.6 + aiResult.score * 0.4));
  } catch (error) {
    console.warn(`AI scoring skipped for ${job.title}:`, error);
    return baseScore;
  }
}

sync().catch(console.error);