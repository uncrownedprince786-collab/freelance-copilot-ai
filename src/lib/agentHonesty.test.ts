import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentJobCard,
  DeterministicInput,
  deterministicReply,
  opportunityBasis,
  renderDeterministicReply,
} from './agentTypes';

/**
 * The assistant is the surface where an overstated number does the most
 * damage: a user reads "3 proposals so far" and decides to bid. These tests
 * pin the phrasing rules rather than the prose.
 */

function card(over: Partial<AgentJobCard> & { id: string }): AgentJobCard {
  return {
    title: 'Senior React Developer',
    platform: 'Upwork',
    budget: '$2,000',
    score: 78,
    opportunityReason: '',
    proposalCount: 3,
    postedAt: '2026-09-29T09:00:00.000Z',
    country: 'Germany',
    clientName: '',
    clientSpend: '$5,084',
    paymentVerified: false,
    skills: ['react'],
    repeatClient: false,
    repeatClientCount: 0,
    actFast: false,
    category: 'High',
    competitionLabel: '3 proposals as of 2h ago',
    competitionOutdated: false,
    leadScore: 82,
    leadBand: 'high',
    leadReasons: ['Strong stated budget (about $2k)', 'Low competition'],
    leadRisks: [],
    authenticityStatus: 'supported',
    duplicateStatus: 'independent',
    ...over,
  };
}

function input(over: Partial<DeterministicInput> = {}): DeterministicInput {
  return { intent: 'compare', text: 'compare these', cards: [card({ id: 'a' })], ...over };
}

test('the assistant never says a proposal count is "so far"', () => {
  // The count is captured shortly after posting and never refreshed, so on
  // an older listing "so far" asserts something the system does not know.
  const stale = card({
    id: 'a',
    competitionLabel: '3 proposals when this listing was checked 5 days ago — not a current figure',
    competitionOutdated: true,
  });
  const replies = [
    opportunityBasis(stale),
    renderDeterministicReply('rank-these', input({ cards: [stale] })),
    renderDeterministicReply('what-to-focus-on', input({ cards: [stale] })),
    deterministicReply(input({ cards: [stale] })),
  ];
  for (const r of replies) {
    assert.ok(!/so far/i.test(r), `reply must not say "so far": ${r.slice(0, 120)}`);
  }
});

test('the observation age travels with the number', () => {
  const stale = card({
    id: 'a',
    competitionLabel: '3 proposals when this listing was checked 5 days ago — not a current figure',
    competitionOutdated: true,
  });
  assert.match(opportunityBasis(stale), /5 days ago/);
  assert.match(renderDeterministicReply('rank-these', input({ cards: [stale] })), /5 days ago/);
});

test('a listing with no published count does not become zero competition', () => {
  const unknown = card({
    id: 'a',
    proposalCount: null,
    competitionLabel: 'no proposal count published by the source',
  });
  const basis = opportunityBasis(unknown);
  assert.match(basis, /no proposal count published/);
  assert.ok(!/\b0 proposals\b/.test(basis));
});

test('the pipeline reason still wins when the source gave one', () => {
  // opportunityBasis prefers the classifier's own stated reason; the
  // competition phrase is the fallback basis, not an override.
  const withReason = card({ id: 'a', opportunityReason: '[HIGH OPPORTUNITY] verified client, low bids' });
  assert.equal(opportunityBasis(withReason), 'verified client, low bids');
});

test('a card with no signals at all says so rather than inventing one', () => {
  const bare = card({
    id: 'a', opportunityReason: '', proposalCount: null, competitionLabel: '',
    paymentVerified: false, repeatClient: false, clientSpend: '', actFast: false,
  });
  assert.match(opportunityBasis(bare), /no client history is published/);
});

test('every deterministic shape still renders something', () => {
  const shapes = [
    'greeting', 'guidance', 'injection', 'trends', 'compare-no-context',
    'compare-no-current-list', 'no-results', 'search-summary', 'refine-summary',
    'rank-these', 'why-top-better', 'more-like-this', 'what-to-focus-on',
    'why-this-score', 'least-competition', 'highest-budget', 'freshest',
    'advice-unavailable',
  ] as const;
  for (const shape of shapes) {
    const reply = renderDeterministicReply(shape, input({ cards: [card({ id: 'a' }), card({ id: 'b' })] }));
    assert.ok(typeof reply === 'string' && reply.length > 0, `${shape} rendered nothing`);
    assert.ok(!/so far/i.test(reply), `${shape} used the banned phrasing`);
  }
});

test('no deterministic reply promises an outcome', () => {
  for (const shape of ['rank-these', 'why-top-better', 'what-to-focus-on'] as const) {
    const reply = renderDeterministicReply(shape, input({ cards: [card({ id: 'a' }), card({ id: 'b' })] }));
    assert.ok(!/will (definitely |certainly )?hire/i.test(reply));
    assert.ok(!/guaranteed|perfect for you|matches your skills/i.test(reply));
  }
});
