import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProfileRequest } from '../src/services/profile/service';
import { MAX_MANUAL_PROFILE_CHARS } from '../src/services/profile/normalizer';

interface FakeResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

function makeFakeResponse(html: string, status = 200): FakeResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => html,
  };
}

const VALID_AI_JSON = JSON.stringify({
  overallScore: 85,
  scores: { title: 90, overview: 80, skills: 75, positioning: 85, portfolio: 70, clientFocus: 88 },
  strengths: ['Clear title'],
  weaknesses: ['Short overview'],
  opportunities: ['Add portfolio'],
  marketTrends: ['React specialists in demand'],
  optimizedProfile: {
    title: 'Senior React Developer',
    overview: 'Overview text.',
    skills: ['React'],
    positioning: 'Expert',
    targetClients: 'Startups',
    portfolioRecommendations: ['Case study'],
    callToAction: 'Contact me',
  },
  priorityActions: [{ priority: 'high', action: 'Fix overview', reason: 'Conversion' }],
});

const UPWORK_HTML = `<!DOCTYPE html><html><head><title>John Doe - Full Stack Developer | Upwork</title></head>
<body>
<script type="application/ld+json">{"@type":"Person","name":"John Doe","jobTitle":"Full Stack Developer","skills":["React","Node.js"]}</script>
<meta name="description" content="Senior full stack developer with 8 years of experience building web apps.">
</body></html>`;

const deps = {
  checkHostPrivate: async () => false,
};

describe('analyzeProfileRequest', () => {
  it('rejects requests with no input', async () => {
    const r = await analyzeProfileRequest({}, deps);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'invalid_input');
  });

  it('rejects oversized manual profiles', async () => {
    const r = await analyzeProfileRequest({ manualProfile: 'x'.repeat(MAX_MANUAL_PROFILE_CHARS + 1) }, deps);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'invalid_input');
  });

  it('surfaces extraction failure when no manual fallback is provided', async () => {
    const r = await analyzeProfileRequest(
      { profileUrl: 'https://www.upwork.com/freelancers/~missing' },
      { ...deps, fetchUrl: async () => makeFakeResponse('', 404) },
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'not_found');
      assert.match(r.error, /404/);
    }
  });

  it('falls back to manual content when extraction fails and paste is provided', async () => {
    const manual = 'Upwork profile\nName: Jane Doe\nSkills: React, Node.js, PostgreSQL\nOverview: I help clients ship reliable web apps.';
    const r = await analyzeProfileRequest(
      { profileUrl: 'https://www.upwork.com/freelancers/~x', manualProfile: manual },
      { ...deps, fetchUrl: async () => makeFakeResponse('', 403), queryProvider: async () => ({ provider: 'Gemini', text: VALID_AI_JSON }) },
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.fromExtraction, false);
      assert.equal(r.platform, 'upwork');
      assert.ok(r.manualNote);
      assert.equal(r.result.overallScore, 85);
    }
  });

  it('analyzes a manually pasted profile without a URL', async () => {
    const manual = 'I am a freelancer on Upwork.\nName: Alice\nTitle: Backend Engineer\nSkills: Go, Docker';
    const r = await analyzeProfileRequest(
      { manualProfile: manual },
      { ...deps, queryProvider: async () => ({ provider: 'OpenAI', text: VALID_AI_JSON }) },
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.platform, 'upwork');
      assert.equal(r.fromExtraction, false);
      assert.equal(r.result.optimizedProfile.title, 'Senior React Developer');
    }
  });

  it('returns a heuristic result when AI text is unusable', async () => {
    const manual = 'Name: Bob\nSkills: Python, Django';
    const r = await analyzeProfileRequest(
      { manualProfile: manual },
      { ...deps, queryProvider: async () => ({ provider: 'Gemini', text: 'I cannot help with that.' }) },
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.result.overallScore >= 0 && r.result.overallScore <= 100, true);
      assert.equal(typeof r.result.optimizedProfile.title, 'string');
    }
  });

  it('returns heuristic result when no AI provider is configured', async () => {
    const manual = 'Name: Carol\nSkills: Design, Figma';
    const r = await analyzeProfileRequest({ manualProfile: manual }, deps);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(r.result.marketTrends.some((t) => /Figma|Design/.test(t)));
    }
  });

  it('extracts and analyzes a public profile successfully', async () => {
    const r = await analyzeProfileRequest(
      { profileUrl: 'https://www.upwork.com/freelancers/~john' },
      {
        ...deps,
        fetchUrl: async () => makeFakeResponse(UPWORK_HTML),
        queryProvider: async () => ({ provider: 'Gemini', text: VALID_AI_JSON }),
      },
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.fromExtraction, true);
      assert.equal(r.platform, 'upwork');
      assert.equal(r.profile.name, 'John Doe');
      assert.ok(r.profile.skills.length > 0);
    }
  });
});
