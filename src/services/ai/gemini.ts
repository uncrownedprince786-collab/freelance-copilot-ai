import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  ensureStartsWithWord,
  extractVerificationWord,
  generateGroundedProposal,
  validateProposal,
} from "@/lib/proposalGrounding";

export interface AIAnalysisResult {
  score: number;
  scoreExplanation: string;
  summary: string;
  risk: "Low" | "Medium" | "High";
  riskExplanation: string[];
  scope: {
    features: string[];
    deliverables: string[];
    complexity: "Low" | "Medium" | "High" | "Expert";
  };
  bidRecommendation: {
    minimum: string;
    recommended: string;
    premium: string;
  };
  questions: string[];
  proposal: string;
}

// Instantiate the SDK (handles empty key gracefully at runtime without crash)
const getGenAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined in environment variables. AI analysis will run in fallback mode.");
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
};

// Retry wrapper specifically for AI rate limits or transient errors
async function retryAI<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 1) throw error;
    console.warn(`AI call failed. Retrying in ${delay}ms... (${retries - 1} retries left). Error:`, error);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryAI(fn, retries - 1, delay * 2);
  }
}

export async function analyzeOpportunityWithAI(
  title: string,
  description: string,
  budget: string,
  platform: string,
  clientName: string = "Client"
): Promise<AIAnalysisResult> {
  const genAI = getGenAIClient();

  if (!genAI) {
    return getFallbackAnalysis(title, description, budget, platform, clientName, "Google Gemini API key is missing. Please configure GEMINI_API_KEY in your .env file.");
  }

  const prompt = `
You are an expert Freelance Copilot AI assistant. Your task is to analyze a freelance opportunity and generate a structured review, bid strategy, and tailored proposal.

Job Details:
- Platform: ${platform}
- Title: ${title}
- Client Name: ${clientName}
- Budget/Salary Info: ${budget}
- Description: ${description}

Analyze the job description and output a JSON object matching the following TypeScript structure exactly. Do not wrap the JSON in markdown code blocks. Output ONLY the raw JSON string.

TypeScript Type Definition:
{
  "score": number, // 0-100 score. Factor in: Budget feasibility, description clarity, skill complexity match. High clarity and good budget = high score.
  "scoreExplanation": string, // 1-2 sentence explanation of why this score was given.
  "summary": string, // Concise summary of the project in exactly 2 to 5 sentences.
  "risk": "Low" | "Medium" | "High", // Risk assessment.
  "riskExplanation": string[], // List of specific reasons for the risk rating.
  "scope": {
    "features": string[], // 3-6 key features required.
    "deliverables": string[], // 3-5 key deliverables.
    "complexity": "Low" | "Medium" | "High" | "Expert"
  },
  "bidRecommendation": {
    "minimum": string, // Minimum bidding rate/amount (e.g. "$40/hr" or "$500")
    "recommended": string, // Recommended sweet spot bidding rate/amount
    "premium": string // Bidding rate/amount for premium value delivery
  },
  "questions": string[], // Exactly 5 highly useful clarifying questions to ask the client to stand out.
  "proposal": string // Single highly professional proposal (3-4 paragraphs). Tone: Humanized, direct, problem-solving. ZERO AI clichés (do not use "delve", "testament", "leverage", "passion", "dynamic", "thrilled"). Address the client by name if it is not "Client" or "Upwork Client".
}

Make sure the proposal:
- Sounds like a real, experienced human developer/freelancer.
- Does NOT use typical AI jargon, generic greetings, or long fluff.
- Starts directly by addressing the client's problem.
- Is grounded ONLY in the Job Details above. Never reference anything not present in the listing.
- Does NOT claim any of the freelancer's own experience, past projects, portfolio, tools they have used, results, or qualifications — no freelancer profile exists.
- Includes a clear call to action to discuss details.
${(() => { const vw = extractVerificationWord(description); return vw ? `- The "proposal" value MUST begin with exactly the word "${vw}" as its very first characters (no greeting or other word before it). Example: "${vw}\\n\\n<proposal>".` : ''; })()}
`;

  try {
    return await retryAI(async () => {
      // Use gemini-2.5-flash for fast, high-quality reasoning
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
      });

      const response = await model.generateContent(
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2, // Low temperature for high consistency
          },
        },
        { timeout: 15000 },
      );

      const responseText = response.response.text();
      if (!responseText) {
        throw new Error("Empty response received from Gemini API");
      }

      const parsed = JSON.parse(responseText.trim()) as AIAnalysisResult;
      
      // Basic validation of keys to ensure formatting succeeded
      if (
        typeof parsed.score !== "number" ||
        !parsed.summary ||
        !parsed.risk ||
        !parsed.proposal ||
        !parsed.questions ||
        parsed.questions.length === 0
      ) {
        throw new Error("Invalid schema structure returned from Gemini");
      }

      // Grounding gate: never surface a proposal that leaks another job's
      // context, uses a canned template, invents candidate claims, or misses the
      // listing's required opening word. When it fails, fall back to the shared
      // deterministic generator, which is grounded in this listing by construction.
      const verificationWord = extractVerificationWord(description);
      const valid = validateProposal(parsed.proposal, { title, description }, verificationWord);
      if (!valid.ok) {
        parsed.proposal = generateGroundedProposal(title, description, { clientName, verificationWord });
      }
      parsed.proposal = ensureStartsWithWord(parsed.proposal, verificationWord);

      return parsed;
    });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error("Gemini AI generation failed or returned bad JSON:", error);
    return getFallbackAnalysis(
      title,
      description,
      budget,
      platform,
      clientName,
      `AI analysis failed at runtime: ${error?.message || error}`
    );
  }
}

// Fallback generator when Gemini fails or key is missing
function getFallbackAnalysis(
  title: string,
  description: string,
  budget: string,
  platform: string,
  clientName: string,
  reason: string
): AIAnalysisResult {
  const words = description.split(/\s+/).length;
  const hasBudget = budget && budget !== "Undetermined";
  
  // Calculate basic heuristics
  let score = 50;
  if (hasBudget) score += 15;
  if (words > 100) score += 10;
  score = Math.min(score, 85);

  const verificationWord = extractVerificationWord(description);

  return {
    score,
    scoreExplanation: `Base score computed algorithmically (${reason})`,
    summary: `This is a freelance opportunity on ${platform} for "${title}". Description details: ${description.substring(0, 150)}...`,
    risk: "Medium",
    riskExplanation: [
      "AI engine could not verify client metrics due to fallback mode.",
      "Requires manual description review to evaluate specific constraints."
    ],
    scope: {
      features: [
        "Core feature implementation based on project description",
        "Setup and deployment support"
      ],
      deliverables: [
        "Completed functional source code",
        "Verification and basic documentation"
      ],
      complexity: words > 150 ? "Medium" : "Low",
    },
    bidRecommendation: {
      minimum: hasBudget ? budget : "$30/hr",
      recommended: hasBudget ? budget : "$45/hr",
      premium: hasBudget ? `Premium value of ${budget}` : "$65/hr",
    },
    questions: [
      "What are the primary performance goals or metrics for this project?",
      "Are there any existing APIs or databases that need integration?",
      "What is your target timeline for the initial MVP launch?",
      "Do you have a design system or wireframes ready?",
      "What level of post-deployment support do you expect?"
    ],
    proposal: generateGroundedProposal(title, description, { clientName, verificationWord }),
  };
}
