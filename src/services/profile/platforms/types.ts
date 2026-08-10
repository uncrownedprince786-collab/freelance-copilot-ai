import type { ProfilePlatform } from '../../../lib/profile/url';
import type { ProfileData } from '../types';

/**
 * Platform-specific strategy for fetching and analyzing public profiles.
 * New platforms implement this interface and register in `index.ts`.
 */
export interface PlatformAdapter {
  platform: ProfilePlatform;
  label: string;
  /** Platform-specific optimization guidance injected into the AI prompt. */
  analysisHints: string[];
  /** Return the URL that should actually be fetched. */
  hintUrlFor(profileUrl: string): string;
  /** Parse fetched HTML into normalized ProfileData (never invents data). */
  extract(html: string, profileUrl: string): ProfileData;
}
