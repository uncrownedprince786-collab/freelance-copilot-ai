"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { 
  getOpportunities, 
  syncOpportunitiesAction, 
  analyzeOpportunityAction,
  getDashboardStats 
} from "./actions/opportunity-actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  RefreshCw, 
  SlidersHorizontal, 
  ExternalLink, 
  Cpu, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  Briefcase,
  Calendar,
  Layers
} from "lucide-react";

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
  analysis?: {
    summary: string;
  } | null;
}

interface DashboardStats {
  total: number;
  highScoring: number;
  analyzedCount: number;
  platformBreakdown: Record<string, number>;
}

interface DashboardProps {
  initialOpportunities: OpportunityItem[];
  initialStats: DashboardStats;
  initialTotal: number;
  errorMsg?: string;
}

export default function Dashboard({ 
  initialOpportunities, 
  initialStats, 
  initialTotal,
  errorMsg: initialError
}: DashboardProps) {
  // State variables for filtering & query options
  const [opportunities, setOpportunities] = useState<OpportunityItem[]>(initialOpportunities);
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("All");
  const [minScore, setMinScore] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"date" | "score">("date");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(Math.ceil(initialTotal / 15));
  
  // Interaction & Async states
  const [isPending, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(initialError || null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Trigger refetch when filters/search values change
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      refetchData();
    }, 300); // 300ms debounce for keyboard search input

    return () => clearTimeout(delayDebounce);
  }, [search, platform, minScore, sortBy, page]);

  const refetchData = () => {
    startTransition(async () => {
      const result = await getOpportunities({
        query: search || undefined,
        platform: platform === "All" ? undefined : platform,
        minScore: minScore > 0 ? minScore : undefined,
        sortBy,
        page,
        limit: 15,
      });

      if (result.success && result.data) {
        // Map types safely
        setOpportunities(result.data as any);
        if (result.meta) {
          setTotalPages(result.meta.totalPages);
        }
        setError(null);
      } else {
        setError(result.error || "Failed to load opportunities.");
      }

      // Also refresh statistics in background
      const statsResult = await getDashboardStats();
      if (statsResult.success && statsResult.stats) {
        setStats(statsResult.stats);
      }
    });
  };

  // Trigger modular collector synchronization
  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await syncOpportunitiesAction();
      if (result.success) {
        setSuccessMsg(`Successfully synced. Imported ${result.importedCount} new opportunities!`);
        refetchData();
      } else {
        setError(result.error || "Collector run failed. Please verify database connection.");
      }
    } catch (err: any) {
      setError(err?.message || "Sync triggered a connection error.");
    } finally {
      setIsSyncing(false);
    }
  };

  // Trigger immediate AI opportunity analysis
  const handleAnalyze = async (id: string) => {
    setAnalyzingIds((prev) => ({ ...prev, [id]: true }));
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await analyzeOpportunityAction(id);
      if (result.success) {
        setSuccessMsg("AI analysis generated successfully!");
        refetchData();
      } else {
        setError(result.error || "AI analysis failed. Check your Gemini API Key.");
      }
    } catch (err: any) {
      setError(err?.message || "Analysis request failed.");
    } finally {
      setAnalyzingIds((prev) => ({ ...prev, [id]: false }));
    }
  };

  // Helper formatting for score styles
  const getScoreColor = (score: number) => {
    if (score >= 75) return "success";
    if (score >= 50) return "warning";
    return "destructive";
  };

  const getRiskColor = (risk: string) => {
    const r = risk.toLowerCase();
    if (r === "low") return "success";
    if (r === "medium") return "warning";
    return "destructive";
  };

  const formatRelativeTime = (dateStr: string | Date): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Notifications block */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-lg bg-green-50 text-green-800 border border-green-200 text-sm dark:bg-green-950/20 dark:text-green-400 dark:border-green-900/30">
          {successMsg}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-neutral-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Total Found</span>
            <Briefcase className="h-4 w-4 text-neutral-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-neutral-400 mt-1">Opportunities parsed</p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-neutral-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">AI Analyzed</span>
            <Cpu className="h-4 w-4 text-neutral-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.analyzedCount}</div>
            <p className="text-xs text-neutral-400 mt-1">Intelligence layer active</p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-neutral-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Top Matched (75+)</span>
            <TrendingUp className="h-4 w-4 text-neutral-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.highScoring}</div>
            <p className="text-xs text-neutral-400 mt-1">High quality fits</p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-neutral-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Platforms</span>
            <Layers className="h-4 w-4 text-neutral-400" />
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex justify-between text-xs text-neutral-600 dark:text-neutral-300">
              <span>Upwork:</span>
              <span className="font-semibold">{stats.platformBreakdown["Upwork"] || 0}</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-600 dark:text-neutral-300">
              <span>Freelancer:</span>
              <span className="font-semibold">{stats.platformBreakdown["Freelancer"] || 0}</span>
            </div>
            <div className="flex justify-between text-xs text-neutral-600 dark:text-neutral-300">
              <span>WWR:</span>
              <span className="font-semibold">{stats.platformBreakdown["WeWorkRemotely"] || 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Control Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-neutral-50 p-4 rounded-lg border border-neutral-100 dark:bg-neutral-900/50 dark:border-neutral-850">
        <div className="flex flex-1 flex-col md:flex-row gap-3 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <Input
              placeholder="Search keyword (e.g. React, Next.js, python)..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9 bg-white"
            />
          </div>

          <div className="flex gap-2">
            {/* Custom Platform select buttons */}
            <div className="flex border border-neutral-200 rounded-md bg-white p-0.5 text-sm dark:border-neutral-800 dark:bg-neutral-950">
              {["All", "Upwork", "Freelancer", "WeWorkRemotely"].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPlatform(p);
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-sm text-xs font-medium cursor-pointer transition-colors ${
                    platform === p 
                      ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950" 
                      : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                  }`}
                >
                  {p === "WeWorkRemotely" ? "WWR" : p}
                </button>
              ))}
            </div>

            {/* Custom Sort buttons */}
            <div className="flex border border-neutral-200 rounded-md bg-white p-0.5 text-sm dark:border-neutral-800 dark:bg-neutral-950">
              <button
                onClick={() => setSortBy("date")}
                className={`px-3 py-1 rounded-sm text-xs font-medium cursor-pointer transition-colors ${
                  sortBy === "date" 
                    ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950" 
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                Latest
              </button>
              <button
                onClick={() => setSortBy("score")}
                className={`px-3 py-1 rounded-sm text-xs font-medium cursor-pointer transition-colors ${
                  sortBy === "score" 
                    ? "bg-neutral-900 text-white dark:bg-neutral-50 dark:text-neutral-950" 
                    : "text-neutral-500 hover:text-neutral-900"
                }`}
              >
                Top Score
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 w-full md:w-auto justify-end">
          {/* Score rating filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium whitespace-nowrap">Min Score:</span>
            <select
              value={minScore}
              onChange={(e) => {
                setMinScore(Number(e.target.value));
                setPage(1);
              }}
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs focus-visible:outline-none dark:border-neutral-800 dark:bg-neutral-950"
            >
              <option value={0}>Any Score</option>
              <option value={50}>50+ Score</option>
              <option value={70}>70+ Score</option>
              <option value={85}>85+ Score</option>
            </select>
          </div>

          <Button 
            variant="outline" 
            onClick={handleSync} 
            disabled={isSyncing} 
            size="sm"
            className="flex items-center gap-2 bg-white"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync Feeds"}
          </Button>
        </div>
      </div>

      {/* Main Opportunities Feed list */}
      {isPending && opportunities.length === 0 ? (
        <div className="py-20 text-center text-neutral-400">Loading opportunities...</div>
      ) : opportunities.length === 0 ? (
        <div className="py-20 border border-dashed border-neutral-200 rounded-lg text-center bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/30">
          <Briefcase className="h-10 w-10 text-neutral-300 mx-auto mb-3" />
          <h3 className="font-semibold text-neutral-800 dark:text-neutral-250">No opportunities found</h3>
          <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
            Try adjusting your search criteria, clearing filters, or syncing the feeds to pull down latest opportunities.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opportunities.map((item) => {
            const isAnalyzing = !!analyzingIds[item.id];
            const hasAnalysis = !!item.analysis?.summary;

            return (
              <Card key={item.id} className="flex flex-col hover:border-neutral-400 dark:hover:border-neutral-700 transition-colors bg-white dark:bg-neutral-950">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-semibold">
                          {item.platform}
                        </Badge>
                        <span className="text-[11px] text-neutral-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                      <CardTitle className="text-base font-bold line-clamp-2 mt-1">
                        {item.title}
                      </CardTitle>
                    </div>

                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <Badge variant={getScoreColor(item.score)} className="text-xs font-bold py-1 px-2.5">
                        {item.score}/100
                      </Badge>
                      {hasAnalysis && (
                        <span className="text-[10px] text-neutral-400">
                          Risk: <span className="font-semibold">{item.risk}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 pb-4">
                  {/* Summary: Show AI summary if available, else standard description fallback snippet */}
                  <div className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                    {hasAnalysis ? (
                      <p className="line-clamp-3 font-medium text-neutral-800 dark:text-neutral-200">
                        {item.analysis?.summary}
                      </p>
                    ) : (
                      <p className="line-clamp-3 italic">
                        {item.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-4 text-xs font-medium text-neutral-500">
                    <DollarSign className="h-4 w-4 shrink-0 text-neutral-400" />
                    <span>Budget:</span>
                    <span className="text-neutral-800 dark:text-neutral-200 font-semibold">{item.budget}</span>
                  </div>
                </CardContent>

                <CardFooter className="pt-0 border-t border-neutral-50 mt-auto dark:border-neutral-900 py-3 flex gap-2">
                  {hasAnalysis ? (
                    <Link href={`/opportunities/${item.id}`} className="flex-1">
                      <Button variant="default" size="sm" className="w-full">
                        View AI Copilot details
                      </Button>
                    </Link>
                  ) : (
                    <>
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={() => handleAnalyze(item.id)}
                        disabled={isAnalyzing}
                        className="flex-1 flex items-center gap-1.5"
                      >
                        <Cpu className={`h-3.5 w-3.5 ${isAnalyzing ? "animate-spin" : ""}`} />
                        {isAnalyzing ? "Analyzing..." : "Analyze with AI"}
                      </Button>
                      <Link href={`/opportunities/${item.id}`}>
                        <Button variant="outline" size="sm">
                          Details
                        </Button>
                      </Link>
                    </>
                  )}
                  
                  <a 
                    href={item.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center justify-center h-9 w-9 rounded-md border border-neutral-200 hover:bg-neutral-100 dark:border-neutral-850 dark:hover:bg-neutral-800"
                    title="Open original job posting"
                  >
                    <ExternalLink className="h-4 w-4 text-neutral-500" />
                  </a>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 pt-4 border-t border-neutral-100 dark:border-neutral-900">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isPending}
          >
            Previous
          </Button>
          <span className="text-xs text-neutral-500 font-medium">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || isPending}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
