/**
 * fetch-trending.ts — pulls REAL trending repos (star velocity, not
 * lifetime stars) from OSS Insight and writes them to
 * data/trending-{daily,weekly,monthly}.json.
 *
 * Why not the GitHub Search API directly?
 *
 *   GitHub has no official trending endpoint. The first cut of this
 *   script used `pushed:>DATE stars:>N sort:stars-desc` on the Search
 *   API as a "hybrid" — but that ranks by *lifetime* stars and any
 *   filter on `pushed:>` matches every actively-maintained repo on
 *   GitHub. Result: freeCodeCamp, public-apis, react, etc. dominated
 *   every window. Not trending — just "popular all-time, still alive."
 *
 *   OSS Insight ingests the GitHub Event Stream (every star, fork,
 *   push, PR globally) and computes per-window deltas. The `stars`
 *   field in their response is **stars gained in the period**, not
 *   total. That's the real velocity signal users mean by "trending."
 *
 *   No auth required, no rate limit hit by daily polls. If OSS Insight
 *   ever goes down, the cron job will fail loudly and we re-evaluate.
 *
 * Outputs are pinned snapshots — the whole file is overwritten each
 * run. Beevibe's find_repo reads these via raw.githubusercontent.com
 * with in-memory TTL caching, so the consumer pays no per-request
 * upstream cost.
 *
 * Usage:
 *   pnpm tsx scripts/fetch-trending.ts
 *   DRY_RUN=1 pnpm tsx scripts/fetch-trending.ts  # logs only
 */
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Period = "daily" | "weekly" | "monthly";

const OSS_INSIGHT_PERIOD: Record<Period, string> = {
  daily: "past_24_hours",
  weekly: "past_week",
  monthly: "past_month",
};

const TOP_N: Record<Period, number> = {
  daily: 30,
  weekly: 50,
  monthly: 50,
};

interface OssInsightRow {
  repo_id?: string;
  repo_name: string;
  primary_language?: string | null;
  description?: string | null;
  stars: string | number;
  forks?: string | number;
  total_score?: string | number;
}

interface OssInsightResponse {
  data?: { rows?: OssInsightRow[] };
}

interface TrendingRepo {
  repo_url: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  /** Stars GAINED in the period — the trending signal. NOT total stars. */
  stars_gained: number;
  rank: number;
}

interface TrendingSnapshot {
  fetched_at: string;
  period: Period;
  source: string;
  repos: TrendingRepo[];
}

/** Filter out spam/piracy/cracked-software rebrands. */
const SPAM_PATTERNS = [
  /\bcrack(ed)?\b/i,
  /\bleaked?\b/i,
  /\bnulled\b/i,
  /\bactivat(or|ion)\b.*\b(key|crack|patch)/i,
  /\b(free\s+download|download.*free.*key)\b/i,
  /\b(serial|license)\s+key\b/i,
  /\bpre-?activated\b/i,
];

function isSpam(desc: string | null | undefined, name: string): boolean {
  const text = `${name} ${desc ?? ""}`.toLowerCase();
  return SPAM_PATTERNS.some((re) => re.test(text));
}

async function fetchPeriod(period: Period): Promise<TrendingSnapshot> {
  const ossPeriod = OSS_INSIGHT_PERIOD[period];
  const url = `https://api.ossinsight.io/v1/trends/repos/?period=${ossPeriod}&language=All`;
  console.log(`[${period}] fetching ${url}`);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "beevibe-capabilities/fetch-trending",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OSS Insight ${res.status} for ${period}: ${body.slice(0, 300)}`);
  }
  const body = (await res.json()) as OssInsightResponse;
  const rows = body.data?.rows ?? [];

  const repos: TrendingRepo[] = [];
  for (const row of rows) {
    if (!row.repo_name || typeof row.repo_name !== "string") continue;
    const [owner, name] = row.repo_name.split("/");
    if (!owner || !name) continue;
    const desc = row.description ?? null;
    if (isSpam(desc, name)) continue;
    const starsGained = typeof row.stars === "number" ? row.stars : parseInt(String(row.stars), 10);
    if (!Number.isFinite(starsGained) || starsGained <= 0) continue;
    repos.push({
      repo_url: `https://github.com/${row.repo_name}`,
      owner,
      name,
      description: desc,
      language: row.primary_language ?? null,
      stars_gained: starsGained,
      rank: repos.length + 1,
    });
    if (repos.length >= TOP_N[period]) break;
  }

  console.log(
    `[${period}] kept ${repos.length} after spam filter ` +
      `(top velocity: +${repos[0]?.stars_gained ?? 0} stars)`,
  );

  return {
    fetched_at: new Date().toISOString(),
    period,
    source: `oss-insight:${ossPeriod}`,
    repos,
  };
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = join(repoRoot, "data");
  const dryRun = process.env.DRY_RUN === "1";

  for (const period of ["daily", "weekly", "monthly"] as const) {
    const snapshot = await fetchPeriod(period);
    if (dryRun) {
      console.log(`[${period}] DRY_RUN — skipping write`);
      console.log(JSON.stringify(snapshot, null, 2).slice(0, 500) + "...");
      continue;
    }
    const path = join(dataDir, `trending-${period}.json`);
    await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(`[${period}] wrote ${path}`);
  }

  console.log("[fetch-trending] done.");
}

main().catch((err) => {
  console.error("[fetch-trending] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
