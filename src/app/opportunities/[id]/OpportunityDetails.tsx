"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  analyzeOpportunityAction, 
  updateTrackingStatusAction 
} from "../../actions/opportunity-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  Cpu, 
  ExternalLink, 
  Copy, 
  Check, 
  DollarSign, 
  AlertTriangle, 
  HelpCircle, 
  FileText, 
  CheckCircle2,
  Zap,
  Activity,
  Trash2,
  CheckSquare
} from "lucide-react";

interface AnalysisData {
  summary: string;
  scope: any; // { features: string[], deliverables: string[], complexity: string }
  riskAnalysis: any; // { level: string, reasons: string[] }
  bidRecommendation: any; // { minimum: string, recommended: string, premium: string }
  questions: any; // string[]
  shortProposal: string;
  standardProposal: string;
  detailedProposal: string;
}

interface TrackingData {
  status: string;
}

interface OpportunityItem {
  id: string;
  title: string;
  description: string;
  budget: string;
  platform: string;
  url: string;
  createdAt: Date | string;
  score: number;
  risk: string;
  analysis?: AnalysisData | null;
  tracking?: TrackingData | null;
}

interface OpportunityDetailsProps {
  opportunity: OpportunityItem;
}

export default function OpportunityDetails({ opportunity: initialOpportunity }: OpportunityDetailsProps) {
  const router = useRouter();
  const [opportunity, setOpportunity] = useState<OpportunityItem>(initialOpportunity);
  const [activeTab, setActiveTab] = useState<"short" | "standard" | "detailed">("standard");
  const [copied, setCopied] = useState(false);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trigger AI analysis on demand
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeOpportunityAction(opportunity.id);
      if (result.success && result.data) {
        setOpportunity(result.data.opportunity as any);
        setError(null);
      } else {
        setError(result.error || "AI analysis failed.");
      }
    } catch (err: any) {
      setError(err?.message || "Analysis request failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Update tracking status (Applied / Skipped) and redirect to main feed
  const handleUpdateStatus = async (status: "APPLIED" | "SKIPPED") => {
    setIsUpdatingStatus(true);
    setError(null);
    try {
      const result = await updateTrackingStatusAction(opportunity.id, status);
      if (result.success) {
        // Redirect back to dashboard feed
        router.push("/");
        router.refresh();
      } else {
        setError(result.error || "Failed to update tracking status.");
      }
    } catch (err: any) {
      setError(err?.message || "Tracking status update failed.");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const copyProposal = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasAnalysis = !!opportunity.analysis;
  const analysis = opportunity.analysis;

  // Formatting helpers
  const getScoreColor = (score: number) => {
    if (score >= 75) return "success";
    if (score >= 50) return "warning";
    return "destructive";
  };

  const getRiskBadgeVariant = (riskStr: string) => {
    const r = riskStr.toLowerCase();
    if (r === "low") return "success";
    if (r === "medium") return "warning";
    return "destructive";
  };

  // Extract proposals text directly from the analysis object
  const currentProposalText = analysis 
    ? activeTab === "short" 
      ? analysis.shortProposal 
      : activeTab === "detailed" 
        ? analysis.detailedProposal 
        : analysis.standardProposal
    : "";

  return (
    <div className="space-y-6">
      {/* Top Navigation Bar */}
      <div className="flex items-center justify-between border-b border-neutral-150 pb-4 dark:border-neutral-900">
        <Link href="/">
          <Button variant="outline" size="sm" className="flex items-center gap-1.5 bg-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Feed
          </Button>
        </Link>

        <div className="flex items-center gap-2">
          {/* Tracking Controls */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleUpdateStatus("SKIPPED")}
            disabled={isUpdatingStatus}
            className="flex items-center gap-1 bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
          >
            <Trash2 className="h-3.5 w-3.5 text-neutral-500" />
            Skip Job
          </Button>

          <Button
            size="sm"
            onClick={() => handleUpdateStatus("APPLIED")}
            disabled={isUpdatingStatus}
            className="flex items-center gap-1 bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-50 dark:text-neutral-950"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Mark as Applied
          </Button>

          <Badge variant="outline" className="font-semibold px-3 py-1">
            {opportunity.platform}
          </Badge>
          
          <a 
            href={opportunity.url} 
            target="_blank" 
            rel="noopener noreferrer"
          >
            <Button size="sm" variant="outline" className="flex items-center gap-1.5 bg-white">
              Original Job
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30">
          {error}
        </div>
      )}

      {/* Main split dashboard view */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Raw job info and AI Analysis */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Core Job Details */}
          <Card className="bg-white dark:bg-neutral-950">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start gap-4">
                <div className="space-y-1.5">
                  <h1 className="text-xl font-extrabold leading-snug text-neutral-900 dark:text-neutral-50">
                    {opportunity.title}
                  </h1>
                  <p className="text-xs text-neutral-400">
                    Posted on {new Date(opportunity.createdAt).toLocaleDateString()} at {new Date(opportunity.createdAt).toLocaleTimeString()}
                  </p>
                </div>
                <Badge variant={getScoreColor(opportunity.score)} className="text-sm font-black px-3 py-1">
                  Fit: {opportunity.score}/100
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6 py-2 border-y border-neutral-100 dark:border-neutral-900 text-sm">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-neutral-400" />
                  <span className="text-neutral-500">Budget:</span>
                  <span className="font-bold text-neutral-850 dark:text-neutral-200">{opportunity.budget}</span>
                </div>
                {hasAnalysis && (
                  <div className="flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-neutral-400" />
                    <span className="text-neutral-500">Risk Assessment:</span>
                    <Badge variant={getRiskBadgeVariant(opportunity.risk)} className="text-[10px] font-bold">
                      {opportunity.risk}
                    </Badge>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">Original Description</h3>
                <div className="text-xs leading-relaxed text-neutral-700 max-h-60 overflow-y-auto bg-neutral-50 p-3 rounded border border-neutral-100 whitespace-pre-wrap dark:bg-neutral-900/40 dark:text-neutral-300 dark:border-neutral-900">
                  {opportunity.description}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Analysis Panel */}
          {!hasAnalysis ? (
            <Card className="border-dashed border-neutral-300 bg-neutral-50/50 text-center py-12 dark:border-neutral-800 dark:bg-neutral-900/20">
              <CardContent className="space-y-4">
                <Cpu className="h-10 w-10 text-neutral-300 mx-auto" />
                <div className="space-y-1">
                  <h3 className="font-bold text-neutral-800 dark:text-neutral-200">AI Analysis Pending</h3>
                  <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                    Evaluate this project with Gemini to extract scopes, risk assessments, biddings strategies, and customized proposals.
                  </p>
                </div>
                <Button 
                  onClick={handleAnalyze} 
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 mx-auto"
                >
                  <Cpu className={`h-4 w-4 ${isAnalyzing ? "animate-spin" : ""}`} />
                  {isAnalyzing ? "Analyzing job..." : "Run AI Copilot Analysis"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              
              {/* Summary & Client Intent */}
              <Card className="bg-white dark:bg-neutral-950">
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-neutral-500" />
                    AI Summary & Opportunity Score
                  </CardTitle>
                  {analysis?.summary && (
                    <CardDescription className="text-xs leading-relaxed text-neutral-700 font-medium dark:text-neutral-300 mt-2">
                      {analysis.summary}
                    </CardDescription>
                  )}
                </CardHeader>
              </Card>

              {/* Scope Breakdown */}
              {analysis?.scope && (
                <Card className="bg-white dark:bg-neutral-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-neutral-500" />
                      Scope Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Required Features</h4>
                        <ul className="text-xs list-disc pl-4 space-y-1 text-neutral-600 dark:text-neutral-300">
                          {analysis.scope.features?.map((f: string, i: number) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Key Deliverables</h4>
                        <ul className="text-xs list-disc pl-4 space-y-1 text-neutral-600 dark:text-neutral-300">
                          {analysis.scope.deliverables?.map((d: string, i: number) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-900 text-xs text-neutral-500">
                      <span>Scope Complexity Match:</span>
                      <Badge variant="secondary" className="font-bold">
                        {analysis.scope.complexity || "Medium"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Risk Analysis */}
              {analysis?.riskAnalysis && (
                <Card className="bg-white dark:bg-neutral-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-neutral-500" />
                      Risk Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-neutral-500">Risk Assessment:</span>
                      <Badge variant={getRiskBadgeVariant(analysis.riskAnalysis.level)} className="font-bold">
                        {analysis.riskAnalysis.level} Risk
                      </Badge>
                    </div>
                    <ul className="text-xs list-disc pl-4 space-y-1 text-neutral-600 dark:text-neutral-300">
                      {analysis.riskAnalysis.reasons?.map((reason: string, i: number) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Recommended Bids */}
              {analysis?.bidRecommendation && (
                <Card className="bg-white dark:bg-neutral-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-neutral-500" />
                      Bidding Strategy
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-neutral-50 p-2.5 rounded border border-neutral-100 text-center dark:bg-neutral-900/40 dark:border-neutral-900">
                        <div className="text-[10px] uppercase font-bold text-neutral-400">Minimum Bid</div>
                        <div className="text-sm font-bold text-neutral-700 dark:text-neutral-300 mt-1">
                          {analysis.bidRecommendation.minimum}
                        </div>
                      </div>
                      <div className="bg-neutral-905 p-2.5 rounded border border-neutral-850 text-center bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950">
                        <div className="text-[10px] uppercase font-bold text-neutral-400">Recommended</div>
                        <div className="text-sm font-black mt-1">
                          {analysis.bidRecommendation.recommended}
                        </div>
                      </div>
                      <div className="bg-neutral-50 p-2.5 rounded border border-neutral-100 text-center dark:bg-neutral-900/40 dark:border-neutral-900">
                        <div className="text-[10px] uppercase font-bold text-neutral-400">Premium Bid</div>
                        <div className="text-sm font-bold text-neutral-700 dark:text-neutral-300 mt-1">
                          {analysis.bidRecommendation.premium}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Questions to Ask */}
              {analysis?.questions && (
                <Card className="bg-white dark:bg-neutral-950">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-neutral-500" />
                      5 Core Questions to Ask Client
                    </CardTitle>
                    <CardDescription className="text-[11px] text-neutral-400">
                      Include these in your proposal message to show subject-matter expertise and prompt client replies.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ol className="text-xs list-decimal pl-4 space-y-2 text-neutral-600 dark:text-neutral-300">
                      {analysis.questions?.map((q: string, i: number) => (
                        <li key={i} className="pl-1">{q}</li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}

            </div>
          )}

        </div>

        {/* Right Side: Proposals Panel */}
        <div className="lg:col-span-5">
          <Card className="bg-white dark:bg-neutral-950 sticky top-6">
            <CardHeader className="pb-3 border-b border-neutral-100 dark:border-neutral-900">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <FileText className="h-4 w-4 text-neutral-500" />
                Tailored Proposal Generator
              </CardTitle>
              <CardDescription className="text-[11px] text-neutral-400">
                Direct, solution-driven cover letters designed to solve the client's problem without robotic AI cliches.
              </CardDescription>
            </CardHeader>

            {!hasAnalysis ? (
              <CardContent className="py-20 text-center text-xs text-neutral-400">
                Please trigger AI analysis on the left to generate customized proposals.
              </CardContent>
            ) : (
              <>
                <CardContent className="pt-4 space-y-4">
                  {/* Proposal tabs switcher */}
                  <div className="flex border border-neutral-200 rounded-md bg-neutral-50 p-0.5 text-xs dark:border-neutral-850 dark:bg-neutral-900">
                    {(["short", "standard", "detailed"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-1.5 rounded-sm font-semibold transition-colors cursor-pointer text-center capitalize ${
                          activeTab === tab
                            ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                            : "text-neutral-400 hover:text-neutral-700"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* Proposal preview container */}
                  <div className="relative">
                    <textarea
                      readOnly
                      value={currentProposalText}
                      className="w-full h-80 rounded-md border border-neutral-200 bg-neutral-50/50 p-3 text-xs leading-relaxed font-mono resize-none focus:outline-none dark:border-neutral-850 dark:bg-neutral-900/20 dark:text-neutral-300"
                    />
                    
                    {/* Copy action */}
                    <div className="absolute right-3 bottom-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => copyProposal(currentProposalText)}
                        className="flex items-center gap-1 bg-white border border-neutral-200 hover:bg-neutral-100 dark:bg-neutral-850 dark:border-neutral-800 shadow-sm"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-[10px] text-green-600 font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-bold">Copy</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-neutral-50 dark:bg-neutral-900/40 py-3 rounded-b-lg border-t border-neutral-100 dark:border-neutral-900 flex items-center gap-2 text-[11px] text-neutral-500 leading-normal">
                  <Zap className="h-4.5 w-4.5 text-amber-500 shrink-0" />
                  <span>
                    Copy this proposal and adapt details (portfolio links, specific tools) to align with your credentials before submitting.
                  </span>
                </CardFooter>
              </>
            )}
          </Card>
        </div>

      </div>
    </div>
  );
}
