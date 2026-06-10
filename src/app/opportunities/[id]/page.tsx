import React from "react";
import Link from "next/link";
import { getOpportunityById } from "../../actions/opportunity-actions";
import OpportunityDetails from "./OpportunityDetails";
import { Button } from "@/components/ui/button";
import { Cpu } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: PageProps) {
  const { id } = await params;
  const result = await getOpportunityById(id);

  if (!result.success || !result.data) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <Cpu className="h-10 w-10 text-neutral-300 mx-auto" />
        <h2 className="text-xl font-bold text-neutral-800 dark:text-neutral-200">Opportunity Not Found</h2>
        <p className="text-xs text-neutral-500 max-w-sm mx-auto">
          The opportunity you requested does not exist or may have been deleted.
        </p>
        <Link href="/">
          <Button variant="default" size="sm">
            Back to Dashboard
          </Button>
        </Link>
      </main>
    );
  }

  const opportunity = result.data;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <header className="flex items-center gap-2 pb-6 mb-6 border-b border-neutral-200 dark:border-neutral-900">
        <Cpu className="h-6 w-6 text-neutral-850 dark:text-neutral-200" />
        <span className="text-lg font-black tracking-tight text-neutral-900 dark:text-neutral-50 uppercase">
          Copilot AI Intelligence Review
        </span>
      </header>

      {/* Main Details client wrapper */}
      <OpportunityDetails opportunity={opportunity as any} />
    </main>
  );
}
