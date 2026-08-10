import type { ProfilePlatform } from '../../lib/profile/url';

/** Normalized profile data shared by extractors and analyzers. */
export interface ProfileData {
  platform: ProfilePlatform | 'unknown';
  profileUrl: string;
  name?: string;
  title?: string;
  overview?: string;
  skills: string[];
  hourlyRate?: string;
  location?: string;
  rating?: number;
  reviewsCount?: number;
  completedJobs?: number;
  experience?: string;
  education?: string[];
  certifications?: string[];
  portfolioItems?: string[];
  rawText?: string;
}

export type ScoreCategory = 'title' | 'overview' | 'skills' | 'positioning' | 'portfolio' | 'clientFocus';

export type ScoreBreakdown = Record<ScoreCategory, number>;

export interface OptimizedProfile {
  title: string;
  overview: string;
  skills: string[];
  positioning: string;
  targetClients: string;
  portfolioRecommendations: string[];
  callToAction: string;
}

export interface PriorityAction {
  priority: 'high' | 'medium' | 'low';
  action: string;
  reason: string;
}

export interface ProfileAnalysisResult {
  overallScore: number;
  scores: ScoreBreakdown;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  marketTrends: string[];
  optimizedProfile: OptimizedProfile;
  priorityActions: PriorityAction[];
}

/** Why automatic extraction could not return usable profile data. */
export type ExtractionFailureReason =
  | 'unsupported_platform'
  | 'invalid_url'
  | 'blocked'
  | 'not_found'
  | 'rate_limited'
  | 'login_required'
  | 'timeout'
  | 'incomplete'
  | 'network_error';

export interface ExtractionFailure {
  ok: false;
  reason: ExtractionFailureReason;
  message: string;
}

export interface ExtractionSuccess {
  ok: true;
  profile: ProfileData;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;
