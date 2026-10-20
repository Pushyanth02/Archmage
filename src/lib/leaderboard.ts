/* Archmage leaderboard — client-side helpers (plain TypeScript, no React).
 *
 * GRACEFUL DEGRADATION: the game also ships as a static export (GitHub Pages,
 * `bun run build:pages`) where "/api/leaderboard" does not exist. Every call
 * here treats network errors, non-2xx responses, and malformed JSON as
 * "leaderboard unavailable" instead of throwing:
 *   - fetchTop()    returns null  → UI must render "leaderboard unavailable".
 *   - submitRun()   returns { ok: false, error } → UI shows the reason
 *                  ("unreachable" means the API can't be reached at all).
 * Callers should never need try/catch around these two functions.
 */

const ENDPOINT = "/api/leaderboard";

/* ---------------------------------- types ---------------------------------- */

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  score: number;
  wave: number;
  kills: number;
  timeSec: number;
  shards: number;
  triumph: boolean;
  endless: boolean;
  seed: string;
  evolutions: string[];
  merges: string[];
  createdAt: string; // ISO timestamp
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  total: number;
}

export interface SubmitRunPayload {
  name: string;
  score: number;
  wave: number;
  kills: number;
  timeSec: number;
  shards: number;
  triumph?: boolean;
  endless?: boolean;
  seed?: string;
  evolutions?: string[];
  merges?: string[];
}

/* --------------------------------- fetch ----------------------------------- */

/** Fetch a page of leaderboard standings. Returns null on ANY failure. */
export async function fetchTop(
  limit = 20,
  offset = 0,
): Promise<LeaderboardResponse | null> {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<LeaderboardResponse> | null;
    if (!data || !Array.isArray(data.entries) || typeof data.total !== "number") {
      return null;
    }
    return { entries: data.entries, total: data.total };
  } catch {
    return null;
  }
}

/** Submit a finished run. Never throws; network failure → "unreachable". */
export async function submitRun(
  payload: SubmitRunPayload,
): Promise<{ ok: true; entry: LeaderboardEntry } | { ok: false; error: string }> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as {
      entry?: LeaderboardEntry;
      error?: string;
    } | null;

    if (res.status === 201) {
      if (data && data.entry && typeof data.entry.score === "number") {
        return { ok: true, entry: data.entry };
      }
      return { ok: false, error: "malformed" };
    }
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}
