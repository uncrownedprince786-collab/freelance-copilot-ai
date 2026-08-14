/**
 * Task 3 tests — proposal generation follows the client's ACTUAL instructions.
 * Covers detection (opening word, ending word, keyword, question, experience,
 * action, format), positions (start / middle / end of a long description),
 * negatives (must NOT be treated as instructions), generator compliance, and
 * validation gating.
 *
 * Run: npx tsx scripts/test-instructions.ts
 */
import assert from 'node:assert';
import {
  extractJobInstructions,
  extractVerificationWord,
  generateGroundedProposal,
  validateProposal,
  startsWithWord,
  endsWithWord,
  findCandidateClaims,
  instructionsToPromptLines,
} from '../src/lib/proposalGrounding';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log('PASS | ' + label);
  } else {
    fail++;
    console.log('FAIL | ' + label + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''));
  }
}

/* ─────────────────────────────────────────────────────────────
 * 1. Detection — required OPENING word
 * ───────────────────────────────────────────────────────────── */
{
  const cases: [string, string][] = [
    ['Start your proposal with SMILE', 'SMILE'],
    ['Please begin your cover letter with the word APPLE', 'APPLE'],
    ['Type the phrase I READ YOUR LISTING as the first line of your bid', 'I READ YOUR LISTING'],
    ['To begin your response, write the word FOCUS', 'FOCUS'],
    ['Your proposal must start with the keyword GOLDMINE', 'GOLDMINE'],
    ['Begin your reply with Hello', 'Hello'],
    ['Start your response with the word "READY"', 'READY'],
    ['Open your application with READY TO WORK', 'READY TO WORK'],
  ];
  for (const [desc, want] of cases) {
    const got = extractVerificationWord(desc);
    check(`openingWord: "${desc.slice(0, 40)}..." -> "${want}"`, got.toUpperCase() === want.toUpperCase(), { got });
  }
}

/* ─────────────────────────────────────────────────────────────
 * 2. Detection — required ENDING word
 * ───────────────────────────────────────────────────────────── */
{
  const cases: [string, string][] = [
    ['End your proposal with the word DONE', 'DONE'],
    ['Conclude your response with THANK YOU', 'THANK YOU'],
    ['Finish your bid with the word CONNECT', 'CONNECT'],
    ['The last word of your proposal should be READY', 'READY'],
    ['Please close your application with the phrase APPLIED TODAY', 'APPLIED TODAY'],
  ];
  for (const [desc, want] of cases) {
    const got = extractJobInstructions(desc).endingWord;
    check(`endingWord: "${desc.slice(0, 40)}..." -> "${want}"`, got.toUpperCase() === want.toUpperCase(), { got });
  }
}

/* ─────────────────────────────────────────────────────────────
 * 3. Detection — KEYWORD anywhere
 * ───────────────────────────────────────────────────────────── */
{
  const cases: [string, string][] = [
    ['Include the word BANANA in your proposal', 'BANANA'],
    ['Your bid must contain the keyword ORANGE', 'ORANGE'],
    ['Write the phrase I AM AVAILABLE somewhere in your response', 'I AM AVAILABLE'],
    ['Please use the keyword EASY in your application', 'EASY'],
    ['Add the word TIGER to your proposal anywhere', 'TIGER'],
    ['To verify you have read this, type the word ELEPHANT in your bid', 'ELEPHANT'],
  ];
  for (const [desc, want] of cases) {
    const got = extractJobInstructions(desc).keywords;
    check(`keyword: "${desc.slice(0, 40)}..." -> "${want}"`, got.some(k => k.toUpperCase() === want.toUpperCase()), { got });
  }
  // An "include" instruction must be a keyword, NOT an opening word.
  const inst = extractJobInstructions('Include the word BANANA in your proposal');
  check('keyword is not misclassified as openingWord', inst.openingWord === '', { inst });
}

/* ─────────────────────────────────────────────────────────────
 * 4. Detection — applicant-directed QUESTION
 * ───────────────────────────────────────────────────────────── */
{
  const cases: string[] = [
    'What is your experience with React?',
    'Do you have experience building APIs?',
    'Are you available to start immediately?',
    'Can you work 9-5 EST?',
    'Tell me about your experience with Laravel.',
    'How soon can you start?',
    'What is your hourly rate?',
  ];
  for (const q of cases) {
    const got = extractJobInstructions('We need a developer. ' + q).questions;
    check(`question: "${q}"`, got.some(x => x.toLowerCase().includes(q.toLowerCase().slice(0, 18))), { got });
  }
  // Client's own project questions (not directed at applicant) must be ignored.
  const noQ = extractJobInstructions('Which stack should we use? What is the timeline for this project? Does anyone know a good payment gateway?');
  check('project questions (no you/your) are not applicant questions', noQ.questions.length === 0, { noQ });
}

/* ─────────────────────────────────────────────────────────────
 * 5. Detection — required EXPERIENCE bar
 * ───────────────────────────────────────────────────────────── */
{
  const cases: [string, string][] = [
    ['We are looking for someone with 3+ years of experience building Shopify apps.', '3+ years of experience building Shopify apps'],
    ['Must have 5+ years of experience with Python and Django.', '5+ years of experience with Python and Django'],
    ['Experience with WordPress is required.', 'experience with WordPress'],
  ];
  for (const [desc, want] of cases) {
    const got = extractJobInstructions(desc).experiences;
    check(`experience: "${desc.slice(0, 40)}..."`, got.some(e => e.toLowerCase().includes(want.toLowerCase().slice(0, 20))), { got });
  }
}

/* ─────────────────────────────────────────────────────────────
 * 6. Detection — requested ACTION + FORMAT
 * ───────────────────────────────────────────────────────────── */
{
  const actions = extractJobInstructions('Please send your portfolio. Include your GitHub link. Submit your application via the link below.');
  check('action: send your portfolio', actions.actions.some(a => /portfolio/i.test(a)), actions.actions);
  check('action: include your GitHub link', actions.actions.some(a => /github/i.test(a)), actions.actions);

  const fmts = extractJobInstructions('Please use the subject line: PROPOSAL - YOUR NAME when applying. Respond in bullet point format.');
  check('format: subject line', fmts.formats.some(f => /subject line/i.test(f)), fmts.formats);
  check('format: bullet point format', fmts.formats.some(f => /bullet/i.test(f)), fmts.formats);
}

/* ─────────────────────────────────────────────────────────────
 * 7. Negatives — must NOT be treated as instructions
 * ───────────────────────────────────────────────────────────── */
{
  const negatives = [
    'DO NOT APPLY if you are not serious.',
    'Do not include the word TEST in your proposal.',
    'If you do not have experience, please do not apply.',
    'Start your day with a smile - we want a positive attitude.',
    'The end result will be a modern dashboard.',
    'We will use the keyword approach for filtering results.',
    'Which technology should we use for this?',
  ];
  for (const d of negatives) {
    const inst = extractJobInstructions(d);
    const nothing = !inst.openingWord && !inst.endingWord && inst.keywords.length === 0 && inst.questions.length === 0;
    check(`negative ignored: "${d.slice(0, 45)}"`, nothing, inst);
  }
  // "End with a question" is an instruction but must NOT become a literal word.
  const endQ = extractJobInstructions('End your proposal with a question.');
  check('"end with a question" not forced to literal word', endQ.endingWord === '', { endQ });
  // "Start with a greeting" is an instruction but must NOT become a literal word.
  const startG = extractJobInstructions('Start your proposal with a greeting.');
  check('"start with a greeting" not forced to literal word', startG.openingWord === '', { startG });
}

/* ─────────────────────────────────────────────────────────────
 * 8. Positions — instructions at the END of a long description
 * ───────────────────────────────────────────────────────────── */
{
  const body = Array.from({ length: 60 }, (_, i) => `The project will involve requirement number ${i} and the client expects clear scope and steady updates along the way.`).join(' ');
  const desc = `${body} Please read everything above before applying. To finish, start your proposal with the word COMMIT and end it with the word DONE. Include the word BANANA somewhere in your proposal and tell us about your experience with Next.js.`;
  const inst = extractJobInstructions(desc);
  check('end-of-description openingWord found', inst.openingWord.toUpperCase() === 'COMMIT', inst);
  check('end-of-description endingWord found', inst.endingWord.toUpperCase() === 'DONE', inst);
  check('end-of-description keyword found', inst.keywords.some(k => k.toUpperCase() === 'BANANA'), inst);
  check('end-of-description question found', inst.questions.length > 0, inst);
}

/* ─────────────────────────────────────────────────────────────
 * 9. Generator compliance — full instruction sets
 * ───────────────────────────────────────────────────────────── */
const JOB = {
  title: 'Fix broken checkout on Shopify store',
  description: 'We run a Shopify store and the checkout is broken. Fix the bug and add payment integrations. Include the word BANANA in your proposal. Start your proposal with COMMIT and end it with the word DONE. What is your experience with Shopify? We are looking for someone with 3+ years of experience building Shopify apps. Please send your portfolio.',
};

const inst = extractJobInstructions(JOB.description);
check('detected openingWord', inst.openingWord.toUpperCase() === 'COMMIT', inst);
check('detected endingWord', inst.endingWord.toUpperCase() === 'DONE', inst);
check('detected keyword', inst.keywords.some(k => k.toUpperCase() === 'BANANA'), inst);
check('detected question', inst.questions.length > 0, inst);
check('detected experience', inst.experiences.length > 0, inst);
check('detected action', inst.actions.length > 0, inst);

const proposal = generateGroundedProposal(JOB.title, JOB.description, { instructions: inst });
console.log('--- generated proposal ---\n' + proposal + '\n--------------------------');

check('proposal starts with openingWord COMMIT', startsWithWord(proposal, 'COMMIT'));
check('proposal ends with endingWord DONE', endsWithWord(proposal, 'DONE'));
check('proposal contains keyword BANANA', /BANANA/i.test(proposal));
check('proposal references Shopify (grounded)', /Shopify/i.test(proposal));
check('proposal has no invented candidate claims', findCandidateClaims(proposal).length === 0, findCandidateClaims(proposal));

const v = validateProposal(proposal, JOB, inst.openingWord, inst);
check('validateProposal passes on compliant proposal', v.ok, v.issues);

/* ─────────────────────────────────────────────────────────────
 * 10. Validation gate — a generic template that ignores the
 *     client's instructions must be REJECTED.
 * ───────────────────────────────────────────────────────────── */
{
  const generic = 'Hi,\n\nI can help with your project. I would be happy to discuss your requirements and find the best solution for you.\n\nBest,';
  const v2 = validateProposal(generic, JOB, inst.openingWord, inst);
  check('generic template rejected (missing opening word / keyword / ending / experience / question)', !v2.ok, v2.issues);
  const v2kw = validateProposal('COMMIT\n\nGreat project, happy to help with Shopify. 3+ years of Shopify experience noted.\n\nBest,\n\nDONE', JOB, 'COMMIT', inst);
  check('partial (opening+ending+experience but no keyword) still rejected', !v2kw.ok, v2kw.issues);
}

/* ─────────────────────────────────────────────────────────────
 * 11. Not a generic template — prompt lines carry every
 *     instruction verbatim.
 * ───────────────────────────────────────────────────────────── */
{
  const lines = instructionsToPromptLines(inst);
  check('prompt lines include opening instruction', lines.some(l => /COMMIT/.test(l)), lines);
  check('prompt lines include ending instruction', lines.some(l => /DONE/.test(l)), lines);
  check('prompt lines include keyword instruction', lines.some(l => /BANANA/.test(l)), lines);
  check('prompt lines include the question verbatim', lines.some(l => /experience with Shopify\?/.test(l)), lines);
  check('prompt lines include experience bar', lines.some(l => /3\+ years/.test(l)), lines);
  check('prompt lines include the action', lines.some(l => /portfolio/i.test(l)), lines);
}

/* ─────────────────────────────────────────────────────────────
 * 12. Multiple patterns in one description; still compliant.
 * ───────────────────────────────────────────────────────────── */
{
  const multi = 'We need help. Use the keyword FOCUS in your bid. Type the word FIRST in the first line of your proposal. End your response with the phrase THANK YOU. Do you have experience with Node.js and PostgreSQL? Respond with the subject line APPLY-NOW.';
  const mi = extractJobInstructions(multi);
  check('multi: openingWord FIRST', mi.openingWord.toUpperCase() === 'FIRST', mi);
  check('multi: keyword FOCUS', mi.keywords.some(k => k.toUpperCase() === 'FOCUS'), mi);
  check('multi: endingWord THANK YOU', mi.endingWord.toUpperCase() === 'THANK YOU', mi);
  check('multi: question detected', mi.questions.length > 0, mi);
  check('multi: format detected', mi.formats.some(f => /subject line/i.test(f)), mi);
  const p = generateGroundedProposal('Database help', multi, { instructions: mi });
  check('multi: proposal starts with FIRST', startsWithWord(p, 'FIRST'));
  check('multi: proposal ends with THANK YOU', endsWithWord(p, 'THANK YOU'));
  check('multi: proposal contains FOCUS', /FOCUS/i.test(p));
  check('multi: validateProposal passes', validateProposal(p, { title: 'Database help', description: multi }, mi.openingWord, mi).ok);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
