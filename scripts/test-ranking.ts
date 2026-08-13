import { compareOpportunities } from "./src/lib/opportunityRanking";

interface J {
  id: string;
  postedAt?: string | null;
  proposalCount?: number | null;
  score?: number | null;
}
const now = Date.now();
const m = (minutesAgo: number) => new Date(now - minutesAgo * 60 * 1000).toISOString();
const j = (id: string, ageMin: number | null, proposals: number | null, score: number): J => ({
  id,
  postedAt: ageMin === null ? null : m(ageMin),
  proposalCount: proposals,
  score,
});

let pass = 0, fail = 0;
function expectFirst(label: string, a: J, b: J, first: "A" | "B") {
  const r = compareOpportunities(a, b); // <0 means a first
  const ordered = r < 0 ? "A" : r > 0 ? "B" : "TIE";
  if (ordered === first) { pass++; console.log("PASS | " + label + " -> " + ordered); }
  else { fail++; console.log("FAIL | " + label + " -> got " + ordered + " expected " + first + " (cmp=" + r + ")"); }
}

// Example 1: 1 min vs 3 min, same props & score -> A first (small freshness gap matters)
expectFirst("1min vs 3min (0prop,80) -> A", j("A", 1, 0, 80), j("B", 3, 0, 80), "A");

// Example: A(1min) beats B(2h) even with 0 proposals vs 0 and score 80 vs 100 (major gap dominates)
expectFirst("1min/80 vs 120min/100 -> A", j("A", 1, 0, 80), j("B", 120, 0, 100), "A");

// Example C: A(2min,0prop,90) beats B(3min,5prop,70)
expectFirst("2min/0prop/90 vs 3min/5prop/70 -> A", j("A", 2, 0, 90), j("B", 3, 5, 70), "A");

// Example D: combined signal, NOT single-field priority -> B wins (fewer props + higher score, 1 min older)
expectFirst("2min/2prop/90 vs 3min/0prop/95 -> B (combined)", j("A", 2, 2, 90), j("B", 3, 0, 95), "B");

// Null proposal count treated as worst-in-class: a confirmed 0 outranks unknown at same age/score
expectFirst("null proposals outranks 0 proposals (same age/score)", j("A", 5, null, 80), j("B", 5, 0, 80), "B");

// Unknown age (null postedAt) always sorts last, even vs score=0
expectFirst("unknown age last vs 1min/0prop/0", j("A", null, 0, 100), j("B", 1, 0, 0), "B");

// Fresher + fewer proposals + higher score clearly above
expectFirst("1min/0prop/100 vs 60min/50prop/0 -> A", j("A", 1, 0, 100), j("B", 60, 50, 0), "A");

// 1-5 minute sensitivity within same tier (5-min gap decides, same props/score)
expectFirst("1min vs 5min (0prop,80) -> A", j("A", 1, 0, 80), j("B", 5, 0, 80), "A");

// Determinism: identical jobs -> stable id tiebreak (a < b -> A first)
expectFirst("identical -> stable id tiebreak (A<id B)", j("a", 1, 0, 80), j("b", 1, 0, 80), "A");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail > 0 ? 1 : 0);
