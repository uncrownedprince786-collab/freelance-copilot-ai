import { prisma } from "@/lib/db";
import { analyzeOpportunityWithAI } from "./gemini";

export async function analyzeOpportunity(opportunityId: string) {
  console.log(`[Analyzer] Starting AI analysis for opportunity: ${opportunityId}`);

  // 1. Retrieve the opportunity from the database
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      analysis: true,
    },
  });

  if (!opportunity) {
    throw new Error(`Opportunity with ID ${opportunityId} not found`);
  }

  // 2. Call the Gemini AI analysis engine
  const aiResult = await analyzeOpportunityWithAI(
    opportunity.title,
    opportunity.description,
    opportunity.budget,
    opportunity.platform,
    opportunity.clientName || "Client"
  );

  // 3. Save the results inside a database transaction to ensure consistency
  const result = await prisma.$transaction(async (tx) => {
    // A. Update the Opportunity core attributes (score and risk level)
    const updatedOpportunity = await tx.opportunity.update({
      where: { id: opportunityId },
      data: {
        score: aiResult.score,
        risk: aiResult.risk,
      },
    });

    // B. Create or Update the Analysis record (now containing proposal text)
    const analysisData = {
      summary: aiResult.summary,
      scope: {
        features: aiResult.scope.features,
        deliverables: aiResult.scope.deliverables,
        complexity: aiResult.scope.complexity,
      },
      riskAnalysis: {
        level: aiResult.risk,
        reasons: aiResult.riskExplanation,
      },
      bidRecommendation: {
        minimum: aiResult.bidRecommendation.minimum,
        recommended: aiResult.bidRecommendation.recommended,
        premium: aiResult.bidRecommendation.premium,
      },
      questions: aiResult.questions,
      proposal: aiResult.proposal,
    };

    const analysis = await tx.analysis.upsert({
      where: { opportunityId },
      create: {
        opportunityId,
        ...analysisData,
      },
      update: analysisData,
    });

    return {
      opportunity: updatedOpportunity,
      analysis,
    };
  });

  console.log(`[Analyzer] Completed AI analysis for opportunity: ${opportunityId}. Score: ${result.opportunity.score}`);
  return result;
}
