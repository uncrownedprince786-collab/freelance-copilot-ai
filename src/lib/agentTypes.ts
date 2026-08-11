/**
 * Client-safe types and constants for the Agent panel.
 * This file must not import any server-only modules.
 */

/** Compact card the client renders under an agent message. */
export interface AgentJobCard {
  id: string;
  title: string;
  platform: string;
  budget: string;
  score: number;
  proposalCount: number | null;
  postedAt: string;
  country: string;
  clientName: string;
  clientSpend: string;
  paymentVerified: boolean;
  skills: string[];
  repeatClient: boolean;
  repeatClientCount: number;
  actFast: boolean;
  category: string;
}

export const AGENT_GREETING =
  `Hi! Welcome to Lead Hunter.

I'm your AI assistant. I can help you discover relevant opportunities, understand the freelance market, analyze jobs, and make better decisions using the data on this platform.

How may I help you today?`;

export const AGENT_SUGGESTIONS = [
  'Find me recent React jobs',
  'What skills are in demand?',
  'Which jobs should I prioritize?',
  'Compare the top opportunities',
  'How can I find better opportunities?',
];