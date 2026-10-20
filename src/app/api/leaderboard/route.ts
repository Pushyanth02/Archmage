import { NextResponse } from "next/server";
import type { LeaderboardEntry as LeaderboardEntryRow, Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";

/* Archmage global leaderboard — route handlers only (no server actions, no pages).
   One row per finished run. Canonical ordering: score DESC, timeSec ASC,
   createdAt ASC (equal scores are broken by the faster run, then the earlier
   submission). Every response is JSON and carries Cache-Control: no-store so
   proxies never cache standings. */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/* Ledger keeps only its best MAX_ROWS runs; weaker ones are pruned on insert. */
const MAX_ROWS = 500;
/* One offering per IP per window. */
const RATE_WINDOW_MS = 10_000;

const ORDER: Prisma.LeaderboardEntryOrderByWithRelationInput[] = [
  { score: "desc" },
  { timeSec: "asc" },
  { createdAt: "asc" },
];

/* -------------------------------- validation ------------------------------- */

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/* Player alias: trim, strip C0 control characters + DEL, then require 2..16. */
const playerName = z
  .string()
  .transform((raw) => raw.trim().replace(/[\u0000-\u001F\u007F]/g, ""))
  .pipe(
    z
      .string()
      .min(2, "must be at least 2 characters")
      .max(16, "must be at most 16 characters"),
  );

const submitSchema = z.object({
  name: playerName,
  score: z.number().int().min(0).max(10_000_000),
  wave: z.number().int().min(0).max(9_999),
  kills: z.number().int().min(0).max(999_999),
  timeSec: z.number().int().min(0).max(86_400),
  shards: z.number().int().min(0).max(999_999),
  triumph: z.boolean().default(false),
  endless: z.boolean().default(false),
  seed: z.string().max(64).default(""),
  evolutions: z.array(z.string().max(64)).max(24).default([]),
  merges: z.array(z.string().max(64)).max(24).default([]),
});

/* ------------------------------ rate limiting ------------------------------ */

/* Module-scoped map of IP -> last accepted submit timestamp (ms epoch). */
const lastSubmitAt = new Map<string, number>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "x-unknown";
}

/* --------------------------------- helpers --------------------------------- */

function respond(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function splitList(joined: string): string[] {
  if (!joined) return [];
  return joined.split("|").filter((part) => part.length > 0);
}

function joinList(items: string[]): string {
  /* "|" is the storage separator — strip it from names so round-trips stay exact. */
  return items.map((item) => item.replace(/\|/g, "")).join("|");
}

function serialize(row: LeaderboardEntryRow, rank: number) {
  return {
    rank,
    id: row.id,
    name: row.name,
    score: row.score,
    wave: row.wave,
    kills: row.kills,
    timeSec: row.timeSec,
    shards: row.shards,
    triumph: row.triumph,
    endless: row.endless,
    seed: row.seed,
    evolutions: splitList(row.evolutions),
    merges: splitList(row.merges),
    createdAt: row.createdAt.toISOString(),
  };
}

function validationError(error: z.ZodError): NextResponse {
  const issue = error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  const message = issue?.message ?? "Invalid run data.";
  return respond({ error: `${where}${message}` }, 400);
}

/* ----------------------------------- GET ----------------------------------- */

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      limit: params.get("limit") ?? undefined,
      offset: params.get("offset") ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);

    const { limit, offset } = parsed.data;
    const [rows, total] = await Promise.all([
      db.leaderboardEntry.findMany({ orderBy: ORDER, take: limit, skip: offset }),
      db.leaderboardEntry.count(),
    ]);

    const entries = rows.map((row, index) => serialize(row, offset + index + 1));
    return respond({ entries, total });
  } catch {
    return respond({ error: "The ledger is closed." }, 500);
  }
}

/* ----------------------------------- POST ---------------------------------- */

export async function POST(request: Request): Promise<NextResponse> {
  try {
    /* Rate limit: 1 submit per RATE_WINDOW_MS per IP; clean stale keys as we go. */
    const key = clientKey(request);
    const now = Date.now();
    for (const [ip, at] of lastSubmitAt) {
      if (now - at >= RATE_WINDOW_MS) lastSubmitAt.delete(ip);
    }
    const previous = lastSubmitAt.get(key);
    if (previous !== undefined && now - previous < RATE_WINDOW_MS) {
      return respond({ error: "Too many offerings — the rift needs a moment." }, 429);
    }
    lastSubmitAt.set(key, now);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond({ error: "Malformed offering — expected a JSON body." }, 400);
    }

    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const run = parsed.data;

    const created = await db.leaderboardEntry.create({
      data: {
        name: run.name,
        score: run.score,
        wave: run.wave,
        kills: run.kills,
        timeSec: run.timeSec,
        shards: run.shards,
        triumph: run.triumph,
        endless: run.endless,
        seed: run.seed,
        evolutions: joinList(run.evolutions),
        merges: joinList(run.merges),
      },
    });

    /* Prune: keep at most MAX_ROWS rows — delete the worst beyond the cut. */
    const total = await db.leaderboardEntry.count();
    if (total > MAX_ROWS) {
      const doomed = await db.leaderboardEntry.findMany({
        orderBy: ORDER,
        skip: MAX_ROWS,
        take: total - MAX_ROWS,
        select: { id: true },
      });
      if (doomed.length > 0) {
        await db.leaderboardEntry.deleteMany({
          where: { id: { in: doomed.map((row) => row.id) } },
        });
      }
    }

    /* Rank = 1 + number of rows that sort strictly above this one. */
    const better = await db.leaderboardEntry.count({
      where: {
        OR: [
          { score: { gt: created.score } },
          { score: created.score, timeSec: { lt: created.timeSec } },
          { score: created.score, timeSec: created.timeSec, createdAt: { lt: created.createdAt } },
        ],
      },
    });

    return respond({ entry: serialize(created, better + 1) }, 201);
  } catch {
    return respond({ error: "The ledger is closed." }, 500);
  }
}
