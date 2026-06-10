import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

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
}

interface AnalysisOptions {
  platform?: string;
  budget?: string;
}

export class MultiAI {
  async analyze(title: string, description: string, options: AnalysisOptions = {}): Promise<JobAnalysis> {
    const providerOrder = [
      { name: 'Gemini', runner: () => this.callGemini(title, description, options) },
      { name: 'OpenAI', runner: () => this.callOpenAI(title, description, options) },
      { name: 'Grok', runner: () => this.callGrok(title, description, options) },
      { name: 'DeepSeek', runner: () => this.callDeepSeek(title, description, options) }
    ];

    for (const provider of providerOrder) {
      if (this.isConfigured(provider.name)) {
        try {
          const result = await provider.runner();
          if (result) {
            return result;
          }
        } catch (error) {
          console.warn(`[AI] ${provider.name} failed:`, error);
        }
      }
    }

    return this.fallbackAnalysis(title, description, options);
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

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return this.parseProviderResponse(text, title, description, options);
  }

  private async callOpenAI(title: string, description: string, options: AnalysisOptions): Promise<JobAnalysis | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const client = new OpenAI({ apiKey });
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
      })
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
      })
    });

    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content ?? '';
    return this.parseProviderResponse(text, title, description, options);
  }

  private buildPrompt(title: string, description: string, options: AnalysisOptions): string {
    return `You are an expert freelance proposal strategist. Analyze this opportunity and return ONLY valid JSON.

Title: ${title}
Description: ${description.substring(0, 2200)}
Platform: ${options.platform ?? 'Unknown'}
Budget: ${options.budget ?? 'Undetermined'}

Write a proposal that sounds confident, human, trustworthy, and persuasive. The client should feel that the freelancer understands the project, can reduce risk, and is a strong fit. Avoid generic filler. Be specific, calm, and professional.

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
  "proposal": "A polished 1-paragraph proposal tailored to this project, written as if from a top freelancer speaking directly to the client"
}`;
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
        proposal: payload.proposal || this.generateProposal('Fallback proposal', ''),
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
    let score = 50;
    const reasons: string[] = [];

    const goodSignals = ['urgent', 'long term', 'ongoing', 'production', 'api', 'database', 'mobile', 'web app', 'full stack', 'senior', 'architecture', 'cloud', 'aws'];
    const badSignals = ['simple', 'easy', 'small budget', 'quick fix', 'beginner', 'cheap', 'low price'];
    const riskSignals = ['payment', 'deposit', 'advance', 'whatsapp', 'telegram', 'crypto', 'bitcoin', 'western union', 'upfront'];

    goodSignals.forEach((signal) => {
      if (text.includes(signal)) score += 4;
    });
    badSignals.forEach((signal) => {
      if (text.includes(signal)) score -= 6;
    });
    if (riskSignals.some((signal) => text.includes(signal))) {
      score -= 18;
      reasons.push('Potential payment or advance-payment red flags detected');
    }

    if (description.length < 120) {
      score -= 8;
      reasons.push('Description is short and may lack detail');
    }

    if (title.toLowerCase().includes('full stack') || title.toLowerCase().includes('senior')) {
      score += 8;
      reasons.push('Senior or full-stack scope suggests stronger opportunity value');
    }

    score = Math.min(100, Math.max(0, score));

    let risk: 'Low' | 'Medium' | 'High' = 'Medium';
    if (score >= 75) risk = 'Low';
    else if (score <= 35) risk = 'High';

    if (!reasons.length) {
      reasons.push('Standard review based on keyword and scope signals');
    }

    const bidAmount = this.estimateBidAmount(title, description, score);
    const questions = [
      'What is the exact timeline and milestones for this project?',
      'Do you have an existing codebase or are you starting from scratch?',
      'What is your budget range and preferred engagement model?',
      'Will there be ongoing support after delivery?',
      'Do you already have technical requirements or design assets?'
    ];

    return {
      summary: `Fallback review for "${title}" on ${options.platform ?? 'Unknown'}: ${score >= 70 ? 'Strong signals for a quality opportunity' : score >= 45 ? 'Moderate opportunity that needs a closer look' : 'High caution recommended before bidding'}`,
      score,
      risk,
      reasons: reasons.slice(0, 4),
      bidAmount,
      questions,
      proposal: this.generateProposal(title, description),
      originalBudget: this.extractBudgetText(description, options),
      originalTimeline: this.extractTimeline(description),
      clientDetails: this.extractClientDetails(title, description),
      technicalBlockers: this.inferTechnicalBlockers(title, description),
      blockerSolutions: this.inferBlockerSolutions(title, description),
      suggestedEta: this.suggestEta(title, description, score)
    };
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

  private generateProposal(title: string, description: string): string {
    const text = `${title} ${description}`.toLowerCase();
    const stack = /wordpress|php|laravel|react|next|node|python|django|mobile|flutter|react native|shopify|webflow|api/i.test(text) ? 'technical' : 'project';

    return `Hi there,\n\nI reviewed your request for ${title} and I can see this is a ${stack} opportunity that needs both strong execution and clear communication. I would approach it with a practical delivery plan, close collaboration, and attention to the details that matter most to the client. My goal would be to make the process feel smooth, reliable, and low-risk while delivering a polished result that fits your goals.\n\nIf you want, I’d be happy to discuss the scope in more detail and propose a plan that fits both the timeline and budget.\n\nBest regards,\nFreelancer`;
  }
}