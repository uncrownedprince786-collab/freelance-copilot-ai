import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseProfileAnalysis, heuristicProfileAnalysis } from '../src/services/profile/analyzer';
import type { ProfileData } from '../src/services/profile/types';

describe('parseProfileAnalysis', () => {
  it('parses a valid AI JSON response', () => {
    const text = JSON.stringify({
      overallScore: 82,
      scores: { title: 90, overview: 80, skills: 75, positioning: 85, portfolio: 70, clientFocus: 90 },
      strengths: ['Clear title'],
      weaknesses: ['Short overview'],
      opportunities: ['Add portfolio'],
      marketTrends: ['React specialists in demand'],
      optimizedProfile: {
        title: 'Senior React Developer',
        overview: 'A great overview.',
        skills: ['React', 'TypeScript'],
        positioning: 'Expert',
        targetClients: 'Startups',
        portfolioRecommendations: ['Add case study'],
        callToAction: 'Contact me',
      },
      priorityActions: [{ priority: 'high', action: 'Fix overview', reason: 'Conversion' }],
    });
    const r = parseProfileAnalysis(text);
    assert.ok(r);
    assert.equal(r.overallScore, 82);
    assert.equal(r.scores.title, 90);
    assert.equal(r.optimizedProfile.title, 'Senior React Developer');
    assert.equal(r.priorityActions[0].priority, 'high');
  });

  it('clamps out-of-range scores to 0..100', () => {
    const text = JSON.stringify({
      overallScore: 250,
      scores: { title: -5, overview: 120, skills: 55, positioning: 42, portfolio: 60, clientFocus: 44 },
    });
    const r = parseProfileAnalysis(text);
    assert.ok(r);
    assert.equal(r.overallScore, 100);
    assert.equal(r.scores.title, 0);
    assert.equal(r.scores.overview, 100);
  });

  it('defaults missing scores to 50', () => {
    const text = JSON.stringify({ overallScore: 60, scores: { title: 80 } });
    const r = parseProfileAnalysis(text);
    assert.ok(r);
    assert.equal(r.scores.overview, 50);
  });

  it('returns null for non-JSON text', () => {
    assert.equal(parseProfileAnalysis('this is not JSON'), null);
  });

  it('handles JSON embedded in markdown fences', () => {
    const r = parseProfileAnalysis('Here you go:\n```json\n{"overallScore":77,"scores":{"title":80,"overview":70,"skills":60,"positioning":75,"portfolio":70,"clientFocus":80}}\n```');
    assert.ok(r);
    assert.equal(r.overallScore, 77);
  });

  it('falls back gracefully on malformed priority actions', () => {
    const text = JSON.stringify({
      overallScore: 60,
      scores: { title: 70, overview: 60, skills: 50, positioning: 60, portfolio: 50, clientFocus: 60 },
      priorityActions: [{ priority: 'urgent', action: 'Do something' }, { action: '' }],
    });
    const r = parseProfileAnalysis(text);
    assert.ok(r);
    assert.equal(r.priorityActions.length, 1);
    assert.equal(r.priorityActions[0].priority, 'medium');
  });
});

describe('heuristicProfileAnalysis', () => {
  const fullProfile: ProfileData = {
    platform: 'upwork',
    profileUrl: 'https://www.upwork.com/freelancers/~x',
    name: 'Jane Doe',
    title: 'Full Stack Developer',
    overview: 'I help you ship reliable web apps. Your success matters.',
    skills: ['React', 'Node.js', 'PostgreSQL'],
    rating: 4.9,
    reviewsCount: 12,
    portfolioItems: ['E-commerce dashboard'],
  };

  it('produces a result with all required keys', () => {
    const r = heuristicProfileAnalysis(fullProfile);
    assert.ok(r);
    assert.ok(r.overallScore >= 0 && r.overallScore <= 100);
    for (const key of ['title', 'overview', 'skills', 'positioning', 'portfolio', 'clientFocus'] as const) {
      assert.ok(r.scores[key] >= 0 && r.scores[key] <= 100, `${key} score out of range`);
    }
    assert.equal(typeof r.optimizedProfile.title, 'string');
    assert.ok(Array.isArray(r.marketTrends));
    assert.ok(Array.isArray(r.priorityActions));
  });

  it('derives strengths from actual profile data only', () => {
    const r = heuristicProfileAnalysis(fullProfile);
    assert.ok(r.strengths.some((s) => /Full Stack Developer/.test(s)));
    assert.ok(r.strengths.some((s) => /rating/.test(s)));
  });

  it('flags missing sections as weaknesses', () => {
    const empty: ProfileData = { platform: 'upwork', profileUrl: '', skills: [] };
    const r = heuristicProfileAnalysis(empty);
    assert.ok(r.weaknesses.some((w) => /title/i.test(w)));
    assert.ok(r.weaknesses.some((w) => /overview/i.test(w)));
    assert.ok(r.weaknesses.some((w) => /skills/i.test(w)));
    assert.ok(r.weaknesses.some((w) => /portfolio/i.test(w)));
  });

  it('keeps market trends tied to actual skills (no fabricated numbers)', () => {
    const r = heuristicProfileAnalysis(fullProfile);
    const trendText = r.marketTrends.join(' ');
    assert.match(trendText, /React|Node\.js/);
    assert.ok(!/\b\d+(\.\d+)?% (of|growth|increase)\b/i.test(trendText));
  });
});
