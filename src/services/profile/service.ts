import { extractPublicProfile, type ProfileFetcher } from './extractor';
import { normalizeManualProfile, detectPlatformFromText, MAX_MANUAL_PROFILE_CHARS } from './normalizer';
import { analyzeProfile } from './analyzer';
import { getAdapter } from './platforms';
import type { PlatformAdapter } from './platforms/types';
import type { ProfileData, ProfileAnalysisResult } from './types';

export interface AnalyzeProfileDeps {
  fetchUrl?: ProfileFetcher;
  checkHostPrivate?: (hostname: string) => Promise<boolean>;
  queryProvider?: (prompt: string) => Promise<{ provider: string; text: string } | null>;
}

export interface AnalyzeProfileInput {
  profileUrl?: string;
  manualProfile?: string;
}

export type AnalyzeProfileOutput =
  | {
      ok: true;
      platform: string;
      fromExtraction: boolean;
      profile: ProfileData;
      result: ProfileAnalysisResult;
      provider: string | null;
      manualNote?: string;
    }
  | { ok: false; error: string; reason: string };

const GENERIC_ADAPTER: PlatformAdapter = {
  platform: 'upwork',
  label: 'a freelance marketplace',
  analysisHints: ['Focus on measurable client outcomes and a clear differentiator'],
  hintUrlFor: (url: string) => url,
  extract: (_html: string, url: string): ProfileData => ({ platform: 'unknown', profileUrl: url, skills: [], rawText: '' }),
};

function adapterFor(profile: ProfileData): PlatformAdapter {
  if (profile.platform === 'unknown') return GENERIC_ADAPTER;
  return getAdapter(profile.platform);
}

/**
 * Orchestrate profile market trend + optimizer analysis.
 * Uses injectable fetchUrl/queryProvider so tests can avoid real network/AI calls.
 */
export async function analyzeProfileRequest(input: AnalyzeProfileInput, deps: AnalyzeProfileDeps = {}): Promise<AnalyzeProfileOutput> {
  const profileUrl = typeof input.profileUrl === 'string' ? input.profileUrl.trim() : '';
  const manualProfile = typeof input.manualProfile === 'string' ? input.manualProfile.trim() : '';

  if (!profileUrl && !manualProfile) {
    return { ok: false, error: 'Provide either a profile URL or pasted profile content.', reason: 'invalid_input' };
  }
  if (manualProfile.length > MAX_MANUAL_PROFILE_CHARS) {
    return { ok: false, error: `Pasted profile is too large (max ${MAX_MANUAL_PROFILE_CHARS} characters).`, reason: 'invalid_input' };
  }

  let profile: ProfileData | null = null;
  let fromExtraction = false;
  let manualNote: string | undefined;

  if (profileUrl) {
    const extraction = await extractPublicProfile(profileUrl, { fetchFn: deps.fetchUrl, checkHostPrivate: deps.checkHostPrivate });
    if (extraction.ok) {
      profile = extraction.profile;
      fromExtraction = true;
    } else if (!manualProfile) {
      // No manual fallback provided — surface the extraction failure so the UI
      // can offer the paste fallback.
      return { ok: false, error: extraction.message, reason: extraction.reason };
    } else {
      manualNote = extraction.message;
    }
  }

  if (!profile) {
    const platform = detectPlatformFromText(manualProfile);
    profile = normalizeManualProfile(manualProfile, platform);
  }

  const adapter = adapterFor(profile);
  const result = await analyzeProfile(profile, adapter, { queryProvider: deps.queryProvider });

  return {
    ok: true,
    platform: profile.platform,
    fromExtraction,
    profile,
    result,
    provider: null,
    ...(manualNote ? { manualNote } : {}),
  };
}
