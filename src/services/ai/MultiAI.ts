import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ensureStartsWithWord, extractVerificationWord, generateGroundedProposal } from '@/lib/proposalGrounding';

export interface JobAnalysis {
  summary: string;
  score: number;
  risk: 'Low' | 'Medium' | 'High';
  reasons: string[];
  bidAmount: string;
  questions: string[];
  proposal: string;
  originalBudget?: string;
  originalTimeline?: string;
  clientDetails?: string;
  technicalBlockers?: string[];
  blockerSolutions?: string[];
  suggestedEta?: string;
  /** Word the listing requires the proposal to open with ('' when none). */
  verificationWord?: string;
}

interface AnalysisOptions {
  platform?: string;
  budget?: string;
  clientName?: string;
  // Client + market context (used to ground the model and reduce hallucination)
  skills?: string[];
  totalSpent?: number | null;
  jobsPosted?: number | null;
  totalHires?: number | null;
  rating?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetType?: string;
  proposalCount?: number | null;
  interviewingCount?: number | null;
  experienceLevel?: string;
  duration?: string;
  connectsRequired?: number | null;
  paymentVerified?: boolean;
  opportunityId?: string;
  // Repeat-client signal — an active buyer with multiple open listings.
  repeatClient?: boolean;
  clientJobsCount?: number;
  // Required opening word extracted from the listing (e.g. "SMILE").
  verificationWord?: string;
  // Corrective guidance from a rejected attempt, appended to the prompt.
  regenerationNote?: string;
}

export class MultiAI {
  async analyze(title: string, description: string, options: AnalysisOptions = {}): Promise<JobAnalysis> {
    // Resolve the required opening word from the listing once, so every provider
    // and the fallback both see it (explicit option wins over re-extraction).
    const effectiveOptions: AnalysisOptions = {
      ...options,
      verificationWord: options.verificationWord || extractVerificationWord(description),
    };
    const providerOrder = [
      { name: 'Gemini', runner: () => this.callGemini(title, description, effectiveOptions) },
      { name: 'OpenAI', runner: () => this.callOpenAI(title, description, effectiveOptions) },
      { name: 'Grok', runner: () => this.callGrok(title, description, effectiveOptions) },
      { name: 'DeepSeek', runner: () => this.callDeepSeek(title, description, effectiveOptions) },
    ];

    for (const provider of providerOrder) {
      if (this.isConfigured(provider.name)) {
        try {
          const result = await provider.runner();
          if (result) {
            return this.finalize(result, effectiveOptions);
          }
        } catch (error) {
          console.warn(`[AI] ${provider.name} failed:`, error);
        }
      }
    }

    return this.finalize(this.fallbackAnalysis(title, description, effectiveOptions), effectiveOptions);
  }

  /** Post-process any provider result so the proposal always honors the
   *  listing's required opening word before it is surfaced. */
  private finalize(result: JobAnalysis, options: AnalysisOptions): JobAnalysis {
    const required = options.verificationWord || '';
    if (required) {
      result.proposal = ensureStartsWithWord(result.proposal, required);
    }
    result.verificationWord = required;
    return result;
  }

  async analyzeJob(title: string, description: string): Promise<JobAnalysis> {
    return this.analyze(title, description);
  }

  private isConfigured(provider: string): boolean {
    switch (provider) {
      case 'Gemini':
        return Boolean(process.env.GEMINI_API_KEY);
      case 'OpenAI':
        return Boolean(process.env.OPENAI_API_KEY);
      case 'Grok':
        return Boolean(process.env.GROK_API_KEY);
      case 'DeepSeek':
        return Boolean(process.env.DEEPSEEK_API_KEY);
      default:
        return false;
    }
  }

  private async callGemini(title: string, description: string, options: AnalysisOptions): Promise<JobAnalysis | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = this.buildPrompt(title, description, options);

    const result = await model.generateContent(prompt, { timeout: 15000 });
    const text = result.response.text();
    return this.parseProviderResponse(text, title, description, options);
  }

  private async callOpenAI(title: string, description: string, options: AnalysisOptions): Promise<JobAnalysis | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const client = new OpenAI({ apiKey, timeout: 15000 });
    const prompt = this.buildPrompt(title, description, options);
    const response = await client.responses.create({
      model: 'gpt-4.1-mini',
      input: [{ role: 'user', content: prompt }]
    });

    const text = typeof response === 'string' ? response : (response.output_text ?? '');
    return this.parseProviderResponse(text, title, description, options);
  }

  private async callGrok(title: string, description: string, options: AnalysisOptions): Promise<JobAnalysis | null> {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) return null;

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-2-1212',
        messages: [{ role: 'user', content: this.buildPrompt(title, description, options) }]
      }),
      signal: AbortSignal.timeout(15000)
    });

    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content ?? '';
    return this.parseProviderResponse(text, title, description, options);
  }

  private async callDeepSeek(title: string, description: string, options: AnalysisOptions): Promise<JobAnalysis | null> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return null;

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: this.buildPrompt(title, description, options) }]
      }),
      signal: AbortSignal.timeout(15000)
    });

    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content ?? '';
    return this.parseProviderResponse(text, title, description, options);
  }

  private buildPrompt(title: string, description: string, options: AnalysisOptions): string {
    // Ground the model in verifiable client + market signals so the proposal and
    // bid stay data-driven instead of speculative.
    const clientMetrics: string[] = [];
    if (options.rating != null) clientMetrics.push(`${options.rating}/5 stars`);
    if (options.totalSpent && options.totalSpent > 0) clientMetrics.push(`$${options.totalSpent.toLocaleString()} lifetime spent`);
    if (options.jobsPosted != null) clientMetrics.push(`${options.jobsPosted} jobs posted`);
    if (options.totalHires != null) clientMetrics.push(`${options.totalHires} total hires`);
    if (options.proposalCount != null) clientMetrics.push(`${options.proposalCount} proposals so far`);
    if (options.interviewingCount != null) clientMetrics.push(`${options.interviewingCount} in interview`);
    if (options.paymentVerified) clientMetrics.push('payment verified');
    if (options.repeatClient) {
      clientMetrics.push(options.clientJobsCount != null && options.clientJobsCount > 0
        ? `active repeat client — has ${options.clientJobsCount} other open listing(s) from this client`
        : 'active repeat client — multiple listings from this client');
    } else if (options.repeatClient === false) {
      clientMetrics.push('no other open listings seen from this client in the current window');
    }
    const metricsLine = clientMetrics.length ? clientMetrics.join('; ') : 'no client metrics available';

    const skillsLine = options.skills && options.skills.length
      ? options.skills.join(', ')
      : (options.platform ? '' : '');

    const budgetParts: string[] = [];
    if (options.budgetType) budgetParts.push(options.budgetType);
    if (options.budgetMin != null) budgetParts.push(`$${options.budgetMin}`);
    if (options.budgetMax != null && options.budgetMax !== options.budgetMin) budgetParts.push(`- $${options.budgetMax}`);
    // Prefer the display string (real currency symbol from the listing) when
    // available; only fall back to numeric fields otherwise.
    const budgetLine = options.budget
      ? options.budget
      : (budgetParts.length ? budgetParts.join(' ') : 'Undetermined');

    return `You are an expert freelance proposal strategist. Analyze this opportunity and return ONLY valid JSON.

Title: ${title}
Description: ${description.substring(0, 2200)}
Platform: ${options.platform ?? 'Unknown'}

CLIENT & MARKET SIGNALS (ground truth — weigh these heavily):
- Client metrics: ${metricsLine}.
- Required skills: ${skillsLine || 'none listed'}.
- Stated budget: ${budgetLine}.
- Experience level: ${options.experienceLevel || 'Not specified'}.
- Contract duration: ${options.duration || 'Not specified'}.
- Connects to bid: ${options.connectsRequired != null ? options.connectsRequired : 'N/A'}.

STRICT RULES:
- You do NOT know the freelancer's skills, experience, budget, or preferences. No user profile exists.
- NEVER claim a job "matches your skills", "is perfect for you", "fits your budget", "is within your budget", or any similar personal-fit claim. If asked, say such data does not exist.
- Base the score, risk, summary, bid, and reasons ONLY on the CLIENT & MARKET SIGNALS above and the description text. Do not invent facts, budgets, or metrics that are not listed.
- Every reason in "reasons" must cite a specific signal from the list above (for example: "Budget is $500-$1,000, indicating a well-funded project" or "Competition is low, with only 3 proposals"). No generic filler.
- For "bidAmount", recommend a plausible range derived from the stated budget and scope — this is a recommendation, clearly separate from the listed budget.

PROPOSAL (1-3 short paragraphs, written as a real freelancer speaking directly to the client):
- Base EVERY sentence on the Title and Description above. Reference the client's actual requirements, the specific technologies/tasks mentioned, and the deliverables implied by the listing.
- Open by showing you understood the client's actual problem in your own words (one sentence).
- Then give a concise, relevant approach tied to what the listing actually describes — do NOT invent features, deliverables, or technologies that were not mentioned.
- Do NOT use generic filler or boilerplate such as "clean, maintainable code", "transparent communication", "fast turnaround and high quality", "I am available to discuss your scope", or "schedule a quick chat".
- Do NOT claim any of your own experience, past projects, portfolio, tools you have used, results you achieved, or qualifications — none of that information exists.
- End with a natural, specific call to action (e.g. ask for a missing detail the listing did not provide, like budget, timeline, or access to existing code/designs).
- If the description is thin, say what you would need from the client to proceed — never fabricate specifics.
${options.verificationWord ? `\nMANDATORY OPENING (strictly enforced):\n- The "proposal" value MUST begin with exactly the word "${options.verificationWord}" — it must be the very first characters of the proposal text, with no greeting, name, or any other word before it. Do not put it in quotes, brackets, or punctuation. Example: "${options.verificationWord}\\n\\n<rest of proposal>".` : ''}\n
Return JSON with these exact keys:
{
  "summary": "A short, clear summary of why the project is attractive and what matters most",
  "score": 0,
  "risk": "Low|Medium|High",
  "reasons": ["reason 1", "reason 2", "reason 3"],
  "bidAmount": "$100-200",
  "questions": ["question 1", "question 2", "question 3"],
  "originalBudget": "The budget stated in the listing",
  "originalTimeline": "The stated timeline or deadline",
  "clientDetails": "A concise summary of the client goals, constraints, and project context",
  "technicalBlockers": ["technical blocker 1", "technical blocker 2"],
  "blockerSolutions": ["how to address blocker 1", "how to address blocker 2"],
  "suggestedEta": "A realistic ETA estimate in days or weeks",
  "proposal": "A polished 1-2 paragraph proposal tailored to this project, written as if from a top freelancer speaking directly to the client"
}
${options.regenerationNote ? `\nCORRECTIVE GUIDANCE (from a rejected previous attempt — address every point):\n${options.regenerationNote}\n` : ''}`;
  }

  private parseProviderResponse(text: string, title: string, description: string, options: AnalysisOptions): JobAnalysis | null {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const payload = match ? JSON.parse(match[0]) : JSON.parse(text);
      return {
        summary: payload.summary || 'Analysis unavailable',
        score: Number(payload.score ?? 50),
        risk: ['Low', 'Medium', 'High'].includes(payload.risk) ? payload.risk : 'Medium',
        reasons: Array.isArray(payload.reasons) ? payload.reasons : ['Review requirements carefully'],
        bidAmount: payload.bidAmount || '$100-200',
        questions: Array.isArray(payload.questions) ? payload.questions : [],
        proposal: payload.proposal || generateGroundedProposal(title, description, {
          clientName: options.clientName,
          skills: options.skills,
          verificationWord: options.verificationWord,
        }),
        originalBudget: payload.originalBudget || this.extractBudgetText(description, options),
        originalTimeline: payload.originalTimeline || this.extractTimeline(description),
        clientDetails: payload.clientDetails || this.extractClientDetails(title, description),
        technicalBlockers: Array.isArray(payload.technicalBlockers) ? payload.technicalBlockers : this.inferTechnicalBlockers(title, description),
        blockerSolutions: Array.isArray(payload.blockerSolutions) ? payload.blockerSolutions : this.inferBlockerSolutions(title, description),
        suggestedEta: payload.suggestedEta || this.suggestEta(title, description, Number(payload.score ?? 50))
      };
    } catch {
      return null;
    }
  }

  private fallbackAnalysis(title: string, description: string, options: AnalysisOptions): JobAnalysis {
    const text = `${title} ${description}`.toLowerCase();
    const projectType = this.classifyProjectType(title, description);

    let score = 50;
    const reasons: string[] = [];

    const growthSignals = ['growth', 'acquisition', 'meta', 'paid media', 'cac', 'ltv', 'roas', 'telehealth', 'e-commerce', 'd2c', 'conversion', 'funnel', 'marketing strategy'];
    const devSignals = ['full stack', 'api', 'database', 'mobile app', 'frontend', 'backend', 'next.js', 'react', 'node', 'wordpress'];
    const strongSignals = ['long term', 'ongoing', 'production', 'architecture', 'saas', 'platform', 'dashboard', 'performance', 'scale', 'growth', 'strategy'];
    const badSignals = ['simple', 'easy', 'quick fix', 'small website', 'beginner', 'cheap', 'low price'];
    const riskSignals = ['payment', 'deposit', 'advance', 'whatsapp', 'telegram', 'crypto', 'bitcoin', 'western union', 'upfront'];

    if (projectType === 'growth') {
      growthSignals.forEach((signal) => {
        if (text.includes(signal)) score += 8;
      });
      if (/paid acquisition|meta|facebook|instagram|tiktok|google ads/i.test(text)) {
        score += 10;
        reasons.push('Performance marketing requirements show clear business upside');
      }
      if (/cac|aov|cvr|ltv|roas|funnel/i.test(text)) {
        score += 12;
        reasons.push('The role is tied to measurable acquisition and revenue metrics');
      }
      if (/telehealth|healthcare|e-commerce|d2c|saas/i.test(text)) {
        score += 8;
        reasons.push('The client is operating in a scalable, high-ROI vertical');
      }
    } else if (projectType === 'development') {
      devSignals.forEach((signal) => {
        if (text.includes(signal)) score += 6;
      });
      if (/full stack|senior|architecture|api|database|mobile|platform/i.test(text)) {
        score += 10;
        reasons.push('Technical complexity suggests this project has real delivery value');
      }
    }

    strongSignals.forEach((signal) => {
      if (text.includes(signal)) score += 5;
    });
    badSignals.forEach((signal) => {
      if (text.includes(signal)) score -= 6;
    });

    if (riskSignals.some((signal) => text.includes(signal))) {
      score -= 18;
      reasons.push('Potential payment or trust concerns should be clarified upfront');
    }

    if (description.length < 120) {
      score -= 8;
      reasons.push('Description is sparse and may require more discovery questions');
    }

    if (projectType === 'growth' && /ongoing|monthly|retainer|scale|portfolio/i.test(text)) {
      score += 10;
      reasons.push('This looks like an ongoing growth engagement rather than a one-off task');
    }

    if (projectType === 'development' && /long term|ongoing|production|scalable/i.test(text)) {
      score += 8;
      reasons.push('The project appears to have product continuity and long-term value');
    }

    score = Math.min(100, Math.max(0, score));

    let risk: 'Low' | 'Medium' | 'High' = 'Medium';
    if (score >= 75) risk = 'Low';
    else if (score <= 35) risk = 'High';

    if (!reasons.length) {
      reasons.push('Opportunity looks viable based on the scope and structure of the request');
    }

    const bidAmount = this.estimateBidAmount(title, description, score);
    const questions = this.buildQuestions(projectType);

    return {
      summary: this.buildSummary(title, projectType, score, options.platform),
      score,
      risk,
      reasons: reasons.slice(0, 4),
      bidAmount,
      questions,
      proposal: generateGroundedProposal(title, description, {
        clientName: options.clientName,
        skills: options.skills,
        verificationWord: options.verificationWord,
      }),
      originalBudget: this.extractBudgetText(description, options),
      originalTimeline: this.extractTimeline(description),
      clientDetails: this.extractClientDetails(title, description),
      technicalBlockers: this.inferTechnicalBlockers(title, description),
      blockerSolutions: this.inferBlockerSolutions(title, description),
      suggestedEta: this.suggestEta(title, description, score)
    };
  }

  private buildSummary(title: string, projectType: string, score: number, platform?: string): string {
    const platformName = platform ?? 'Unknown';
    if (projectType === 'growth') {
      return `This ${platformName} opportunity looks like a growth-focused engagement with measurable commercial upside. The brief emphasizes funnel quality, acquisition strategy, and performance metrics, which makes it a strong fit if you can improve conversion, scale channels, or reduce CAC.`;
    }
    if (projectType === 'development') {
      return `This ${platformName} opportunity appears to be a technical delivery project with clear scope and moderate-to-high execution risk. It is strongest if the work is structured, time-boxed, and supported by a clean technical plan.`;
    }
    return `Fallback review for "${title}" on ${platformName}: ${score >= 70 ? 'Strong signals for a worthwhile opportunity' : score >= 45 ? 'A moderate opportunity that needs a closer look' : 'High caution recommended before bidding'}`;
  }

  private buildQuestions(projectType: string): string[] {
    if (projectType === 'growth') {
      return [
        'What is the current funnel and which acquisition channel is underperforming?',
        'What are your CAC, AOV, and target LTV or ROAS goals?',
        'Are you looking for strategy only, execution support, or both?',
        'What are the current conversion bottlenecks and what is the testing roadmap?',
      ];
    }
    if (projectType === 'development') {
      return [
        'Do you have an existing codebase or should this be built from scratch?',
        'What is the exact timeline, milestone structure, and handoff process?',
        'Are there any API, hosting, or third-party dependencies we should plan around?',
        'What success metrics will define the project as complete?',
      ];
    }
    return [
      'What is the exact timeline and milestones for this project?',
      'Do you have an existing codebase or are you starting from scratch?',
      'What is your budget range and preferred engagement model?',
      'Will there be ongoing support after delivery?',
      'Do you already have technical requirements or design assets?',
    ];
  }

  private classifyProjectType(title: string, description: string): 'growth' | 'development' | 'general' {
    const text = `${title} ${description}`.toLowerCase();
    if (/growth|marketing|meta|cac|ltv|roas|funnel|customer acquisition|telehealth|e-commerce|d2c|strategy|paid media|conversion/i.test(text)) {
      return 'growth';
    }
    if (/full stack|react|next.js|api|database|mobile app|wordpress|frontend|backend|web app|website|development|developer/i.test(text)) {
      return 'development';
    }
    return 'general';
  }

  private extractBudgetText(description: string, options: AnalysisOptions): string {
    const match = description.match(/\$\d+(?:,\d{3})*(?:\s*-\s*\$\d+(?:,\d{3})*)?/i);
    return match?.[0] || options.budget || 'Negotiable';
  }

  private extractTimeline(description: string): string {
    const match = description.match(/(\d+)\s*(days?|weeks?|months?)/i);
    if (match) return match[0];
    if (/urgent|asap|immediately/i.test(description)) return 'ASAP / flexible';
    return 'Flexible';
  }

  private extractClientDetails(title: string, description: string): string {
    const text = `${title} ${description}`.trim();
    if (!text) return 'The client shared a standard scope request with a clear delivery expectation.';
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  }

  private inferTechnicalBlockers(title: string, description: string): string[] {
    const text = `${title} ${description}`.toLowerCase();
    const blockers: string[] = [];
    if (/api|integration/i.test(text)) blockers.push('Integration complexity may require careful API design and testing.');
    if (/mobile|react native|flutter/i.test(text)) blockers.push('Cross-platform delivery may require device-specific QA.');
    if (/performance|scalability|high traffic/i.test(text)) blockers.push('Performance and scaling constraints may need architecture planning.');
    if (/legacy|existing codebase|wordpress/i.test(text)) blockers.push('Legacy or existing system constraints may require migration or compatibility work.');
    return blockers.slice(0, 3);
  }

  private inferBlockerSolutions(title: string, description: string): string[] {
    const text = `${title} ${description}`.toLowerCase();
    const solutions: string[] = [];
    if (/api|integration/i.test(text)) solutions.push('Start with a clean integration plan, define a small proof of concept, and validate payloads early.');
    if (/mobile|react native|flutter/i.test(text)) solutions.push('Use a shared component approach and test on both iOS and Android from the start.');
    if (/performance|scalability|high traffic/i.test(text)) solutions.push('Design for scalability with caching, monitoring, and staged rollout.');
    if (/legacy|existing codebase|wordpress/i.test(text)) solutions.push('Audit the current stack first and keep the solution backward-compatible.');
    return solutions.slice(0, 3);
  }

  private suggestEta(title: string, description: string, score: number): string {
    const text = `${title} ${description}`.toLowerCase();
    if (/full stack|architecture|enterprise|platform|saas|api|mobile/i.test(text)) {
      return score >= 80 ? '2-4 weeks' : '1-3 weeks';
    }
    if (/wordpress|landing page|simple|quick fix|small website/i.test(text)) {
      return '3-7 days';
    }
    return '1-2 weeks';
  }

  private estimateBidAmount(title: string, description: string, score: number): string {
    const text = `${title} ${description}`.toLowerCase();
    const isComplex = /full stack|mobile app|saas|architecture|api|payment|dashboard|platform|enterprise|backend|frontend|system|integration/i.test(text);
    const isSimple = /landing page|simple|basic|wordpress website|one-page|small website|quick fix/i.test(text);

    if (score >= 80) return isComplex ? '$2000-$5000' : '$1200-$3000';
    if (score >= 60) return isComplex ? '$1200-$2500' : '$800-$1800';
    if (isSimple) return '$300-$900';
    return '$500-$1500';
  }
}