import { createRequire } from 'module';
const req = createRequire(import.meta.url);
try {
  const serverOnlyId = req.resolve('server-only');
  req.cache[serverOnlyId] = { id: serverOnlyId, filename: serverOnlyId, loaded: true, exports: {} } as NodeModule;
} catch { /* not installed */ }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Crawl4AiProvider } = req('../src/providers/Crawl4AiProvider') as typeof import('../src/providers/Crawl4AiProvider');

const provider = new Crawl4AiProvider();
const parseTile = (provider as unknown as { parseTile(b: string): ReturnType<Crawl4AiProvider['parseTile']> }).parseTile.bind(provider);
const parseUpworkHtml = (provider as unknown as { parseUpworkHtml(h: string): ReturnType<Crawl4AiProvider['parseUpworkHtml']> }).parseUpworkHtml.bind(provider);

let pass = 0, fail = 0;
function assert(label: string, got: boolean) {
  if (got) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
}

const tile = `
<section data-testid="job-tile">
  <h2><a href="https://www.upwork.com/jobs/~01HRSmpl4aNdCoDe">React &amp; Next.js Developer for SaaS Dashboard</a></h2>
  <div data-test="job-description"><p>Build a <strong>dashboard</strong> with charts and auth.</p></div>
  <div data-test="budget">$25.00-$50.00/hr</div>
  <div data-test="proposals">10 to 15</div>
  <div data-test="posted-on">Posted 2 hours ago</div>
  <div data-test="client-country">United States</div>
  <div data-test="client-name">Acme Corp</div>
  <div data-test="client-location">United States</div>
  <a class="up-skill-tag">React</a><a class="up-skill-tag">Next.js</a>
</section>`;

console.log('[1] parseTile (full card):');
const job = parseTile(tile);
assert('parsed a job', !!job);
assert('id/url normalized', job?.url === 'https://www.upwork.com/jobs/~01HRSmpl4aNdCoDe');
assert('title HTML-decoded', job?.title === 'React & Next.js Developer for SaaS Dashboard');
assert('description tags stripped', job?.description === 'Build a dashboard with charts and auth.');
assert('budget parsed (hourly range)', job?.budget?.type === 'hourly' && job?.budget?.min === 25 && job?.budget?.max === 50);
assert('proposal range -> null (unknown exact)', job?.proposalCount === null);
assert('postedAt relative ~2h', !!job?.postedAt && Math.abs(Date.now() - job.postedAt.getTime()) < 3 * 60 * 60 * 1000);
assert('country', job?.country === 'United States');
assert('clientName', job?.clientName === 'Acme Corp');
assert('skills extracted', Array.isArray(job?.skills) && job?.skills.length === 2 && job?.skills[0] === 'React');
assert('source upwork + platform Upwork', job?.source === 'upwork' && job?.platform === 'Upwork');

console.log('[2] parseProposals conventions:');
const parseProposals = (provider as unknown as { parseProposals(s: string): number | null }).parseProposals.bind(provider);
assert('"50+" -> 50', parseProposals('50+') === 50);
assert('"Less than 5" -> null', parseProposals('Less than 5') === null);
assert('"20" -> 20', parseProposals('20') === 20);
assert('"First to apply" -> null', parseProposals('First to apply') === null);

console.log('[3] parseBudget variants:');
const parseBudget = (provider as unknown as { parseBudget(s: string): object }).parseBudget.bind(provider);
assert('"$500-$1,000" fixed range', parseBudget('$500-$1,000').type === 'fixed' && parseBudget('$500-$1,000').min === 500 && parseBudget('$500-$1,000').max === 1000);
assert('"$3,000" fixed amount', parseBudget('$3,000').type === 'fixed' && parseBudget('$3,000').amount === 3000);
assert('"Hourly: $20-$35" -> hourly', parseBudget('Hourly: $20-$35').type === 'hourly');
assert('empty -> fixed undefined', parseBudget('').type === 'fixed' && parseBudget('').amount === undefined);

console.log('[4] parseUpworkHtml fallback (anchor-level when no cards):');
const fallbackHtml = `<div><h2><a href="https://www.upwork.com/jobs/~FALLBACKxyz">Fallback Job Title</a></h2></div>`;
const fallbackJobs = parseUpworkHtml(fallbackHtml);
assert('anchor fallback finds job', fallbackJobs.length === 1 && fallbackJobs[0].title === 'Fallback Job Title');
assert('anchor fallback id/url', fallbackJobs[0].url === 'https://www.upwork.com/jobs/~FALLBACKxyz');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
