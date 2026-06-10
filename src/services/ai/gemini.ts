import { GoogleGenerativeAI } from "@google/generative-ai";

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
  proposals: {
    shortProposal: string;
    standardProposal: string;
    detailedProposal: string;
  };
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
  platform: string
): Promise<AIAnalysisResult> {
  const genAI = getGenAIClient();

  if (!genAI) {
    return getFallbackAnalysis(title, description, budget, platform, "Google Gemini API key is missing. Please configure GEMINI_API_KEY in your .env file.");
  }

  const prompt = `
You are an expert Freelance Copilot AI assistant. Your task is to analyze a freelance opportunity and generate a structured review, bid strategy, and tailored proposals.

Job Details:
- Platform: ${platform}
- Title: ${title}
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
  "proposals": {
    "shortProposal": string, // Short proposal (1-2 paragraphs), sounds human, zero AI clichés (do not use "delve", "testament", "leverage", "passion", "dynamic", "thrilled"). Direct and problem-solving.
    "standardProposal": string, // Standard proposal (3-4 paragraphs), outlines approach, brief milestones, and call to action.
    "detailedProposal": string // Detailed proposal (comprehensive structure), breaks down approach step-by-step, mentions technical suggestions, deliverables, and next steps.
  }
}

Make sure all proposal types:
- Sound like a real, experienced human developer/freelancer.
- Do NOT use typical AI jargon, generic greetings, or long fluff.
- Start directly by addressing the client's problem.
- Include a clear call to action to discuss details.
`;

  try {
    return await retryAI(async () => {
      // Use gemini-2.5-flash for fast, high-quality reasoning
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
      });

      const response = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2, // Low temperature for high consistency
        },
      });

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
        !parsed.proposals ||
        !parsed.questions ||
        parsed.questions.length === 0
      ) {
        throw new Error("Invalid schema structure returned from Gemini");
      }

      return parsed;
    });
  } catch (error: any) {
    console.error("Gemini AI generation failed or returned bad JSON:", error);
    return getFallbackAnalysis(
      title,
      description,
      budget,
      platform,
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
  reason: string
): AIAnalysisResult {
  const words = description.split(/\s+/).length;
  const hasBudget = budget && budget !== "Undetermined";
  
  // Calculate basic heuristics
  let score = 50;
  if (hasBudget) score += 15;
  if (words > 100) score += 10;
  score = Math.min(score, 85);

  const cleanTitle = title.replace(/[^\w\s-]/g, "");

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
    proposals: {
      shortProposal: `Hi there,\n\nI saw your post for "${title}" and would love to help you build this. I specialize in web development and can deliver a clean, robust solution matching your goals.\n\nCould we jump on a quick call to discuss the milestones?\n\nBest regards,\nFreelancer`,
      standardProposal: `Hi,\n\nI am writing in response to your project post seeking support for "${title}". Based on your description, you need someone who can jump in and handle features like core integrations and code organization.\n\nHere is how I would approach it:\n1. Requirements sync & architecture outline\n2. Iterative feature development with regular demos\n3. Verification, optimization, and deployment.\n\nLet's schedule a call to clarify details.\n\nSincerely,\nFreelancer`,
      detailedProposal: `Subject: Proposal for ${cleanTitle}\n\nDear Client,\n\nI understand you are looking for an experienced developer to execute "${title}". To ensure success, we need to focus on clean structure, testable logic, and seamless integration.\n\nProject Roadmap:\n- Week 1: Core setup, database/API connections, and first functional drafts.\n- Week 2: Refining code logic, styling, and error handling.\n- Week 3: Testing, revision loop, and deployment preparation.\n\nI look forward to discussing how we can work together.\n\nBest,\nFreelancer`,
    },
  };
}
