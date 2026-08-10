import type { PlatformAdapter } from './types';
import { upworkAdapter } from './upwork';
import { freelancerAdapter } from './freelancer';
import type { ProfilePlatform } from '../../../lib/profile/url';

const ADAPTERS: Record<ProfilePlatform, PlatformAdapter> = {
  upwork: upworkAdapter,
  freelancer: freelancerAdapter,
};

export function getAdapter(platform: ProfilePlatform): PlatformAdapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platform}`);
  }
  return adapter;
}

export function registeredPlatforms(): ProfilePlatform[] {
  return Object.keys(ADAPTERS) as ProfilePlatform[];
}
