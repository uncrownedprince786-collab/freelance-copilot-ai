"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runAllCollectors } from "@/collectors/run";
import { analyzeOpportunity } from "@/services/ai/analyzer";
import { isAdminRequest } from "@/lib/adminAuth";

// Input validation schemas using Zod
const GetOpportunitiesSchema = z.object({
  query: z.string().optional(),
  platform: z.string().optional(),
  country: z.string().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  minConnections: z.number().int().min(0).optional(),
  maxConnections: z.number().int().min(0).optional(),
  sortBy: z.enum(["date", "score"]).default("date"),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(15),
});

const IdSchema = z.string().uuid();
const TrackingStatusSchema = z.enum(["APPLIED", "SKIPPED", "NEW"]);

export async function getOpportunities(rawOptions: z.input<typeof GetOpportunitiesSchema>) {
  try {
    // Validate inputs
    const options = GetOpportunitiesSchema.parse(rawOptions);
    const skip = (options.page - 1) * options.limit;

    // Build Prisma query filters
    const where: any = {
      // Only show OPEN jobs and exclude applied/skipped
      status: "OPEN",
      AND: [
        {
          OR: [
            { tracking: null },
            { tracking: { status: { notIn: ["APPLIED", "SKIPPED"] } } },
          ],
        },
      ],
    };

    // 2. Keyword searching - SQLite doesn't support mode: insensitive
    if (options.query) {
      where.AND.push({
        OR: [
          { title: { contains: options.query } },
          { description: { contains: options.query } },
        ],
      });
    }

    // 3. Platform filter
    if (options.platform && options.platform !== "All") {
      where.platform = options.platform;
    }

    // 4. Country filter
    if (options.country && options.country !== "All") {
      where.country = options.country;
    }

    // 5. Min Score filter
    if (options.minScore) {
      where.score = { gte: options.minScore };
    }

    // 6. Connections filter
    if (options.minConnections !== undefined || options.maxConnections !== undefined) {
      where.connections = {};
      if (options.minConnections !== undefined) {
        where.connections.gte = options.minConnections;
      }
      if (options.maxConnections !== undefined) {
        where.connections.lte = options.maxConnections;
      }
    }

    // Determine sorting criteria
    const orderBy: any = {};
    if (options.sortBy === "score") {
      orderBy.score = "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    // Fetch matching data and count total records concurrently
    const [items, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        orderBy,
        skip,
        take: options.limit,
        include: {
          analysis: {
            select: {
              summary: true,
            },
          },
          tracking: true,
        },
      }),
      prisma.opportunity.count({ where }),
    ]);

    return {
      success: true,
      data: items,
      meta: {
        total,
        page: options.page,
        limit: options.limit,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  } catch (error: any) {
    console.error("Failed to retrieve opportunities:", error);
    return {
      success: false,
      data: [],
      meta: { total: 0, page: 1, limit: 15, totalPages: 0 },
      error: error?.message || "Failed to load opportunities. Please verify database connection.",
    };
  }
}

export async function getOpportunityById(id: string) {
  try {
    const validatedId = IdSchema.parse(id);

    const opportunity = await prisma.opportunity.findUnique({
      where: { id: validatedId },
      include: {
        analysis: true,
        tracking: true,
      },
    });

    if (!opportunity) {
      return {
        success: false,
        error: "Opportunity not found",
      };
    }

    return {
      success: true,
      data: opportunity,
    };
  } catch (error: any) {
    console.error(`Failed to load opportunity with ID ${id}:`, error);
    return {
      success: false,
      error: error?.message || "Failed to load opportunity details.",
    };
  }
}

// Server Action to mark status as APPLIED or SKIPPED
export async function updateTrackingStatusAction(opportunityId: string, status: "APPLIED" | "SKIPPED" | "NEW") {
  if (!(await isAdminRequest())) {
    return { success: false, error: "Unauthorized" };
  }
  try {
    const validatedId = IdSchema.parse(opportunityId);
    const validatedStatus = TrackingStatusSchema.parse(status);

    const tracking = await prisma.projectTracking.upsert({
      where: { opportunityId: validatedId },
      create: {
        opportunityId: validatedId,
        status: validatedStatus,
      },
      update: {
        status: validatedStatus,
      },
    });

    // Refresh page cache for paths
    revalidatePath("/");
    revalidatePath(`/opportunities/${validatedId}`);

    return {
      success: true,
      data: tracking,
    };
  } catch (error: any) {
    console.error(`Failed to update tracking status for ${opportunityId}:`, error);
    return {
      success: false,
      error: error?.message || "Failed to update opportunity tracking status.",
    };
  }
}

export async function syncOpportunitiesAction() {
  if (!(await isAdminRequest())) {
    return { success: false, error: "Unauthorized" };
  }
  try {
    const result = await runAllCollectors();
    revalidatePath("/");
    return {
      success: result.success,
      importedCount: result.totalImported,
      details: result.stats,
    };
  } catch (error: any) {
    console.error("Sync action failed:", error);
    return {
      success: false,
      importedCount: 0,
      error: error?.message || "Failed to complete opportunity sync.",
    };
  }
}

export async function analyzeOpportunityAction(opportunityId: string) {
  if (!(await isAdminRequest())) {
    return { success: false, error: "Unauthorized" };
  }
  try {
    const validatedId = IdSchema.parse(opportunityId);
    const result = await analyzeOpportunity(validatedId);

    revalidatePath("/");
    revalidatePath(`/opportunities/${validatedId}`);

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    console.error(`Analysis failed for opportunity ${opportunityId}:`, error);
    return {
      success: false,
      error: error?.message || "Failed to complete AI opportunity analysis.",
    };
  }
}

// Helper to fetch total counts/stats for dashboard summary
export async function getDashboardStats() {
  try {
    // Exclude applied/skipped jobs from stats counters to match what's visible
    const visibleWhere = {
      NOT: {
        tracking: {
          status: {
            in: ["APPLIED", "SKIPPED"]
          }
        }
      }
    };

    const [total, highScoring, analyzedCount] = await Promise.all([
      prisma.opportunity.count({ where: visibleWhere }),
      prisma.opportunity.count({ where: { ...visibleWhere, score: { gte: 75 } } }),
      prisma.opportunity.count({ where: { ...visibleWhere, NOT: { analysis: null } } }),
    ]);

    // Group counts by platform for visible items
    const platformGroups = await prisma.opportunity.groupBy({
      by: ["platform"],
      where: visibleWhere,
      _count: {
        _all: true,
      },
    });

    const platformBreakdown = platformGroups.reduce((acc: any, curr) => {
      acc[curr.platform] = curr._count._all;
      return acc;
    }, {});

    const distinctCountries = await prisma.opportunity.findMany({
      where: visibleWhere,
      select: { country: true },
      distinct: ['country'],
    });
    
    const countries = distinctCountries
      .map(c => c.country)
      .filter((c): c is string => c !== null && c !== "Unknown" && c !== "");

    return {
      success: true,
      stats: {
        total,
        highScoring,
        analyzedCount,
        platformBreakdown,
        countries,
      },
    };
  } catch (error: any) {
    console.error("Failed to fetch dashboard stats:", error);
    return {
      success: false,
      stats: {
        total: 0,
        highScoring: 0,
        analyzedCount: 0,
        platformBreakdown: {},
        countries: [],
      },
      error: error?.message || "Stats unavailable.",
    };
  }
}
