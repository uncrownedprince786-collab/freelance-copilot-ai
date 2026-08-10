import fs from 'fs';
import { getStoragePath } from './storage';

/**
 * Daily cap on on-demand provider searches (Apify/Freelancer) triggered by the
 * manual smart search bar. Autocomplete never counts against this quota.
 */
const DAILY_LIMIT = 25;

interface QuotaState {
  date: string;
  used: number;
}

function quotaFile(): string {
  return getStoragePath('search-quota.json');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): QuotaState {
  try {
    const raw = fs.readFileSync(quotaFile(), 'utf-8');
    const state: QuotaState = JSON.parse(raw);
    if (state.date !== today()) return { date: today(), used: 0 };
    return state;
  } catch {
    return { date: today(), used: 0 };
  }
}

function save(state: QuotaState): void {
  try {
    fs.writeFileSync(quotaFile(), JSON.stringify(state), 'utf-8');
  } catch {
    // Non-critical — failing to persist quota just means it resets next read.
  }
}

export function getSearchQuotaRemaining(): number {
  return Math.max(0, DAILY_LIMIT - load().used);
}

/**
 * Reserve one on-demand provider search. Returns false when the daily quota is
 * exhausted (caller should fall back to the existing job feed instead).
 */
export function consumeSearchQuota(): boolean {
  const state = load();
  if (state.used >= DAILY_LIMIT) return false;
  save({ ...state, used: state.used + 1 });
  return true;
}
